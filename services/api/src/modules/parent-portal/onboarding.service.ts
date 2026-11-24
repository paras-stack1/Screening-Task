import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type {
  ActivateParentAccountRequest,
  ActivateParentAccountResponse,
  InvitationValidationResponse,
  SendOtpResponse,
  VerifyOtpResponse,
} from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import { maskPhone } from '../../integrations/sms/smsSender';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { checkPasswordPolicy, hashPassword, PASSWORD_POLICY_MESSAGES } from '../../utils/password';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { recordAudit } from '../audit/audit.service';
import { hashToken, type ParentPortalSettings } from './invitations.service';
import { CURRENT_LEGAL_VERSIONS, legalAcceptable } from './parentLegal';

export interface OnboardingDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  parentPortal: ParentPortalSettings;
  now?: () => Date;
}

export interface OnboardingContext {
  requestId?: string;
}

const MINUTE = 60_000;
/** PP6 limits (assumptions, documented in docs/api/parent-portal.md). */
export const OTP_LIMITS = {
  maxAttempts: 5,
  resendAfterMs: 60_000,
  perPhonePerHour: 5,
  perInvitationTotal: 10,
  ticketTtlMs: 15 * MINUTE,
};

/** The one answer for any unusable link: unknown, expired, used, revoked or no longer matching. */
const invalidInvitation = () =>
  new AppError(
    404,
    'INVITATION_INVALID',
    'This invitation link is not valid any more. Ask your health worker for a new one.',
  );

/**
 * Parent onboarding, public side (Step 8 stage 4; PP5, PP6, PP8, PP10, PP13).
 *
 * Invitation link -> validate -> send code (SMS) -> verify code -> activation ticket ->
 * activate (password, privacy notice, terms). The parent chooses their own password; no worker or
 * administrator is involved or can see it.
 *
 * - Codes: 6 digits from crypto.randomInt; only HMAC-SHA256(OTP_HMAC_KEY, purpose:invitation:code)
 *   is stored; 5 minutes; at most 5 attempts per code (counted atomically before comparing);
 *   resend after 60 s; 5 codes per phone per hour; 10 per invitation. Never returned or logged.
 * - Verification produces a 15-minute activation ticket (HMAC-signed, bound to the invitation and
 *   the consumed code), so holding the link alone is never enough to activate.
 * - Activation needs the verified phone to still be the guardian's number, the current privacy
 *   notice and terms, and a policy-compliant password (Argon2id). It does NOT grant any consent.
 */
export function createOnboardingService({
  db,
  pii,
  parentPortal,
  now = () => new Date(),
}: OnboardingDependencies) {
  const ttlMs = (parentPortal.otpTtlMinutes ?? 5) * MINUTE;

  function otpKey(): Buffer {
    if (!parentPortal.otpKey) {
      throw new AppError(
        503,
        'OTP_NOT_CONFIGURED',
        'Verification codes cannot be sent right now. Try again later.',
      );
    }
    return parentPortal.otpKey;
  }
  const codeHash = (invitationId: string, code: string) =>
    createHmac('sha256', otpKey()).update(`INVITATION:${invitationId}:${code}`).digest('hex');
  const sign = (payload: string) =>
    createHmac('sha256', otpKey()).update(`parent-activation:${payload}`).digest('base64url');

  /** A usable invitation for this token, with the guardian's current phone - or INVITATION_INVALID. */
  async function openInvitation(token: string, at: Date) {
    const inv = await db.parentInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        guardian: {
          select: {
            id: true,
            deletedAt: true,
            phoneEncrypted: true,
            phoneLookupHash: true,
            parentAccount: { select: { status: true } },
          },
        },
      },
    });
    const g = inv?.guardian;
    if (
      !inv ||
      !g ||
      (inv.status !== 'PENDING' && inv.status !== 'SENT') ||
      inv.expiresAt.getTime() <= at.getTime() ||
      g.deletedAt !== null ||
      // The number the invitation was sent to must still be the guardian's number (PP14).
      !g.phoneEncrypted ||
      g.phoneLookupHash !== inv.phoneLookupHash ||
      (g.parentAccount && g.parentAccount.status !== 'DISABLED')
    ) {
      throw invalidInvitation();
    }
    return { inv, phone: pii.decryptPhone(g.phoneEncrypted, g.id) };
  }

  async function audit(
    action: string,
    entityId: string | undefined,
    outcome: 'SUCCESS' | 'FAILED' | 'DENIED',
    ctx: OnboardingContext,
    details?: Prisma.InputJsonValue,
    tx: PrismaClient | Prisma.TransactionClient = db,
  ) {
    await recordAudit(tx, {
      action,
      entityType: 'parent_invitation',
      entityId,
      outcome,
      requestId: ctx.requestId,
      details,
    });
  }

  return {
    async validate(token: string): Promise<InvitationValidationResponse> {
      const { inv, phone } = await openInvitation(token, now());
      return {
        valid: true,
        maskedPhone: maskPhone(phone),
        expiresAt: inv.expiresAt.toISOString(),
        phoneVerified: inv.phoneVerifiedAt !== null,
      };
    },

    async sendOtp(ctx: OnboardingContext, token: string): Promise<SendOtpResponse> {
      const at = now();
      const { inv, phone } = await openInvitation(token, at);
      otpKey();
      const [latest, perPhone, perInvitation] = await Promise.all([
        db.otpChallenge.findFirst({
          where: { invitationId: inv.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        db.otpChallenge.count({
          where: {
            phoneLookupHash: inv.phoneLookupHash,
            createdAt: { gt: new Date(at.getTime() - 60 * MINUTE) },
          },
        }),
        db.otpChallenge.count({ where: { invitationId: inv.id } }),
      ]);
      if (latest && at.getTime() - latest.createdAt.getTime() < OTP_LIMITS.resendAfterMs) {
        throw new AppError(429, 'OTP_RESEND_TOO_SOON', 'Please wait a minute before asking for a new code.');
      }
      if (perPhone >= OTP_LIMITS.perPhonePerHour || perInvitation >= OTP_LIMITS.perInvitationTotal) {
        await audit('parent_otp.limited', inv.id, 'DENIED', ctx, { perPhone, perInvitation });
        throw new AppError(429, 'OTP_LIMIT', 'Too many codes were requested. Try again later.');
      }
      if (!parentPortal.sms.configured) {
        // Never pretend a code was sent (no provider configured).
        await audit('parent_otp.not_sent', inv.id, 'FAILED', ctx, { smsStatus: 'NOT_CONFIGURED' });
        throw new AppError(
          503,
          'SMS_NOT_CONFIGURED',
          'Codes cannot be sent by SMS yet. Contact your health worker.',
        );
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(at.getTime() + ttlMs);
      const challenge = await db.otpChallenge.create({
        data: {
          purpose: 'INVITATION',
          invitationId: inv.id,
          phoneLookupHash: inv.phoneLookupHash,
          codeHash: codeHash(inv.id, code),
          expiresAt,
          maxAttempts: OTP_LIMITS.maxAttempts,
          createdAt: at,
        },
      });
      let result: Awaited<ReturnType<typeof parentPortal.sms.send>>;
      try {
        result = await parentPortal.sms.send({
          to: phone,
          templateId: 'PARENT_OTP',
          params: { code, minutes: String(Math.round(ttlMs / MINUTE)) },
        });
      } catch (error) {
        result = {
          status: 'FAILED',
          provider: parentPortal.sms.provider,
          error: error instanceof Error ? error.name : 'error',
        };
      }
      await db.smsMessage.create({
        data: {
          guardianId: inv.guardianId,
          purpose: 'OTP',
          templateId: 'PARENT_OTP',
          maskedTo: maskPhone(phone),
          status: result.status,
          provider: result.provider,
          providerMessageId: result.providerMessageId ?? null,
          error: result.error ?? null,
          createdAt: at,
          sentAt: result.status === 'SENT' ? at : null,
        },
      });
      await audit('parent_otp.sent', inv.id, result.status === 'SENT' ? 'SUCCESS' : 'FAILED', ctx, {
        challengeId: challenge.id,
        smsStatus: result.status,
      });
      if (result.status !== 'SENT') {
        logger.warn('parent_otp_sms_not_sent', { invitationId: inv.id, status: result.status });
        throw new AppError(503, 'SMS_NOT_SENT', 'The code could not be sent. Try again in a few minutes.');
      }
      return {
        sent: true,
        maskedPhone: maskPhone(phone),
        expiresAt: expiresAt.toISOString(),
        resendAfter: new Date(at.getTime() + OTP_LIMITS.resendAfterMs).toISOString(),
      };
    },

    async verifyOtp(ctx: OnboardingContext, token: string, code: string): Promise<VerifyOtpResponse> {
      const at = now();
      const { inv } = await openInvitation(token, at);
      const expected = codeHash(inv.id, code);
      const challenge = await db.otpChallenge.findFirst({
        where: { invitationId: inv.id, purpose: 'INVITATION' },
        orderBy: { createdAt: 'desc' },
      });
      // Only the newest code counts; it must be unused, unexpired and have attempts left.
      const usable =
        challenge &&
        !challenge.consumedAt &&
        challenge.expiresAt.getTime() > at.getTime() &&
        challenge.attempts < challenge.maxAttempts;
      if (!challenge || !usable) {
        throw new AppError(400, 'OTP_EXPIRED', 'This code can no longer be used. Ask for a new code.');
      }
      // Count the attempt first (atomically), so parallel guesses cannot exceed the limit.
      const counted = await db.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } },
        data: { attempts: { increment: 1 } },
      });
      if (counted.count === 0)
        throw new AppError(400, 'OTP_EXPIRED', 'This code can no longer be used. Ask for a new code.');

      const match = timingSafeEqual(Buffer.from(challenge.codeHash, 'hex'), Buffer.from(expected, 'hex'));
      if (!match) {
        const attemptsLeft = Math.max(0, challenge.maxAttempts - challenge.attempts - 1);
        await audit('parent_otp.wrong', inv.id, 'FAILED', ctx, { challengeId: challenge.id, attemptsLeft });
        throw new AppError(400, 'OTP_INVALID', 'The code is not correct.', { attemptsLeft });
      }
      const consumed = await db.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: at },
      });
      if (consumed.count === 0)
        throw new AppError(400, 'OTP_EXPIRED', 'This code can no longer be used. Ask for a new code.');
      await db.parentInvitation.update({ where: { id: inv.id }, data: { phoneVerifiedAt: at } });
      await audit('parent_otp.verified', inv.id, 'SUCCESS', ctx, { challengeId: challenge.id });

      const expiresAt = at.getTime() + OTP_LIMITS.ticketTtlMs;
      const payload = `${inv.id}.${challenge.id}.${expiresAt}`;
      return {
        verified: true,
        activationTicket: `${payload}.${sign(payload)}`,
        ticketExpiresAt: new Date(expiresAt).toISOString(),
      };
    },

    async activate(
      ctx: OnboardingContext,
      body: ActivateParentAccountRequest,
    ): Promise<ActivateParentAccountResponse> {
      const at = now();
      const { inv, phone } = await openInvitation(body.token, at);

      // The ticket proves the code was verified for THIS invitation, recently.
      const parts = body.activationTicket.split('.');
      const [invitationId, challengeId, exp, signature] = parts;
      const payload = `${invitationId}.${challengeId}.${exp}`;
      const expected = sign(payload);
      const valid =
        parts.length === 4 &&
        invitationId === inv.id &&
        signature !== undefined &&
        signature.length === expected.length &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) &&
        Number(exp) > at.getTime() &&
        inv.phoneVerifiedAt !== null;
      if (!valid) {
        await audit('parent_account.activation_refused', inv.id, 'DENIED', ctx, { reason: 'NOT_VERIFIED' });
        throw new AppError(403, 'PHONE_NOT_VERIFIED', 'Verify your mobile number with a code first.');
      }
      const verifiedChallenge = await db.otpChallenge.findFirst({
        where: { id: challengeId, invitationId: inv.id, consumedAt: { not: null } },
        select: { id: true },
      });
      if (!verifiedChallenge)
        throw new AppError(403, 'PHONE_NOT_VERIFIED', 'Verify your mobile number with a code first.');

      if (!legalAcceptable(parentPortal.allowDraftLegal ?? false)) {
        throw new AppError(
          503,
          'LEGAL_TEXT_NOT_APPROVED',
          'Accounts cannot be activated until the privacy notice is approved.',
        );
      }
      if (
        body.privacyNoticeVersion !== CURRENT_LEGAL_VERSIONS.PRIVACY_NOTICE ||
        body.termsVersion !== CURRENT_LEGAL_VERSIONS.TERMS
      ) {
        throw AppError.conflict(
          'LEGAL_VERSION_CHANGED',
          'The privacy notice or terms have changed. Please read them again.',
        );
      }
      const digits = phone.replace(/\D/g, '').slice(-10);
      const violation = body.password.replace(/\D/g, '').includes(digits)
        ? 'CONTAINS_PHONE'
        : checkPasswordPolicy(body.password);
      if (violation) {
        const message =
          violation === 'CONTAINS_PHONE'
            ? 'Password must not contain your mobile number'
            : PASSWORD_POLICY_MESSAGES[violation];
        throw AppError.unprocessable('WEAK_PASSWORD', message, { reason: violation });
      }
      const passwordHash = await hashPassword(body.password);

      try {
        const accountId = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Guardian" WHERE id = ${inv.guardianId}::uuid FOR UPDATE`;
          // Single use: only the still-open invitation can be consumed (a parallel activation loses).
          const used = await tx.parentInvitation.updateMany({
            where: { id: inv.id, status: { in: ['PENDING', 'SENT'] }, expiresAt: { gt: at } },
            data: { status: 'USED', usedAt: at },
          });
          if (used.count === 0) throw invalidInvitation();
          const account = await tx.parentAccount.create({
            data: {
              guardianId: inv.guardianId,
              phoneLookupHash: inv.phoneLookupHash,
              passwordHash,
              passwordChangedAt: at,
              privacyNoticeVersion: body.privacyNoticeVersion,
              termsVersion: body.termsVersion,
              acceptedAt: at,
              activatedAt: at,
            },
          });
          // Children the worker confirmed become visible - only while the link still exists.
          const pending = await tx.guardianChildAccess.findMany({
            where: { guardianId: inv.guardianId, status: 'PENDING' },
            include: { childGuardian: { select: { endedAt: true } } },
          });
          for (const row of pending) {
            await tx.guardianChildAccess.update({
              where: { id: row.id },
              data:
                row.childGuardian.endedAt === null
                  ? { status: 'ACTIVE', activatedAt: at }
                  : {
                      status: 'REVOKED',
                      revokedAt: at,
                      revokedById: row.grantedById,
                      revokeReason: 'Guardian link ended before activation',
                    },
            });
          }
          await recordAudit(tx, {
            actorParentAccountId: account.id,
            action: 'parent_account.activated',
            entityType: 'parent_account',
            entityId: account.id,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            details: {
              invitationId: inv.id,
              privacyNoticeVersion: body.privacyNoticeVersion,
              termsVersion: body.termsVersion,
              childrenActivated: pending.filter((p) => p.childGuardian.endedAt === null).length,
            },
          });
          return account.id;
        });
        void accountId;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          // Another live account already uses this verified number or guardian.
          throw AppError.conflict(
            'ACCOUNT_EXISTS',
            'An account already exists for this mobile number. Sign in instead.',
          );
        }
        throw error;
      }
      return { activated: true, maskedPhone: maskPhone(phone) };
    },
  };
}
