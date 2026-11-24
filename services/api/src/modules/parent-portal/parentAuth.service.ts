import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  PARENT_ROLE,
  type ParentAccount as ParentAccountDto,
  type ParentTokensResponse,
  type SendOtpResponse,
} from '@balswasthya/shared-contracts';
import { Prisma, type OtpChallenge, type OtpPurpose, type PrismaClient } from '@prisma/client';
import type { AuthConfig } from '../../config/security';
import { maskPhone } from '../../integrations/sms/smsSender';
import { AppError } from '../../utils/AppError';
import { signAccessToken } from '../../utils/jwt';
import { logger } from '../../utils/logger';
import {
  checkPasswordPolicy,
  hashPassword,
  passwordNeedsRehash,
  PASSWORD_POLICY_MESSAGES,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../../utils/password';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { recordAudit } from '../audit/audit.service';
import { REVOCATION_REASONS } from '../auth/session.service';
import type { ParentPortalSettings } from './invitations.service';
import { OTP_LIMITS } from './onboarding.service';
import {
  createParentSessionFamily,
  findParentFamilyByToken,
  revokeAllParentSessions,
  revokeParentFamily,
  rotateParentRefreshToken,
  type IssuedParentRefreshToken,
} from './parentSession.service';

export interface ParentAuthContext {
  parentAccountId: string;
  /** Session family (`sid`). */
  sessionId: string;
}

export interface ParentAuthDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  parentAuth: AuthConfig;
  parentPortal: ParentPortalSettings;
  now?: () => Date;
}

export interface Meta {
  requestId?: string;
}

const MINUTE = 60_000;
/** Same answer for unknown number, wrong password, temporary lock and disabled account (no enumeration). */
export const PARENT_INVALID_CREDENTIALS =
  'Mobile number or password is not correct, or sign-in is paused after several attempts. Try again later or reset your password.';
const invalidCredentials = () => AppError.unauthorized('INVALID_CREDENTIALS', PARENT_INVALID_CREDENTIALS);
const sessionExpired = () =>
  AppError.unauthorized('SESSION_EXPIRED', 'Session expired. Please sign in again.');
const resetInvalid = () =>
  new AppError(400, 'RESET_INVALID', 'The code is not correct or has expired. Ask for a new code.');
export const FORGOT_PASSWORD_MESSAGE = 'If an account exists for this number, a code has been sent to it.';
/** Password reset / phone change codes per account or number per hour (assumption, PP6). */
const CODES_PER_HOUR = 3;

/**
 * Parent sign-in and account security (Step 8 stage 5; PP2, PP8, PP9, PP10, PP14).
 *
 * - Mobile number + password. Unknown numbers run a dummy Argon2 verification so timing does not
 *   reveal whether an account exists; every failure is the same 401. 5 failures lock sign-in
 *   temporarily (1 min doubling to 15 min), without revealing it.
 * - Separate tokens: audience PARENT_JWT_AUDIENCE, role fixed PARENT_GUARDIAN; rotation + reuse
 *   detection; logout revokes the session immediately.
 * - Forgot password always answers the same; the reset code is checked with the same attempt
 *   counting as activation codes; a reset revokes every session.
 * - Mobile number change: password + code sent to the NEW number. Updates the account and the
 *   guardian record together; workers cannot change a verified number (guardians service).
 */
export function createParentAuthService({
  db,
  pii,
  parentAuth,
  parentPortal,
  now = () => new Date(),
}: ParentAuthDependencies) {
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
  const codeHash = (purpose: OtpPurpose, binding: string, code: string) =>
    createHmac('sha256', otpKey()).update(`${purpose}:${binding}:${code}`).digest('hex');

  async function audit(
    action: string,
    outcome: 'SUCCESS' | 'FAILED' | 'DENIED',
    meta: Meta,
    accountId?: string,
    details?: Prisma.InputJsonValue,
  ) {
    await recordAudit(db, {
      actorParentAccountId: accountId,
      action,
      entityType: 'parent_account',
      entityId: accountId,
      outcome,
      requestId: meta.requestId,
      details,
    });
  }

  async function accountDto(accountId: string): Promise<ParentAccountDto> {
    const a = await db.parentAccount.findUniqueOrThrow({
      where: { id: accountId },
      include: { guardian: { select: { id: true, fullName: true, phoneEncrypted: true } } },
    });
    const childCount = await db.guardianChildAccess.count({
      where: {
        guardianId: a.guardianId,
        status: 'ACTIVE',
        childGuardian: { endedAt: null },
        child: { deletedAt: null },
      },
    });
    const phone = a.guardian.phoneEncrypted ? pii.decryptPhone(a.guardian.phoneEncrypted, a.guardian.id) : '';
    return {
      id: a.id,
      role: PARENT_ROLE,
      guardianName: a.guardian.fullName,
      maskedPhone: maskPhone(phone),
      activatedAt: a.activatedAt.toISOString(),
      passwordChangedAt: a.passwordChangedAt.toISOString(),
      privacyNoticeVersion: a.privacyNoticeVersion,
      termsVersion: a.termsVersion,
      childCount,
    };
  }

  async function tokens(issued: IssuedParentRefreshToken, at: Date): Promise<ParentTokensResponse> {
    const access = await signAccessToken(
      parentAuth.jwt,
      { userId: issued.parentAccountId, sessionId: issued.familyId },
      at,
    );
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: issued.refreshToken,
      refreshTokenExpiresAt: issued.expiresAt.toISOString(),
      account: await accountDto(issued.parentAccountId),
    };
  }

  /** The live account (ACTIVE or LOCKED status) for a verified number, if any. */
  function accountByPhone(phone: string) {
    return db.parentAccount.findFirst({
      where: { phoneLookupHash: pii.phoneLookupHash(phone), status: { in: ['ACTIVE', 'LOCKED'] } },
    });
  }

  async function registerFailedLogin(accountId: string, at: Date) {
    const { failedLoginCount } = await db.parentAccount.update({
      where: { id: accountId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const { maxFailedAttempts, lockoutBaseMs, lockoutMaxMs } = parentAuth.login;
    if (failedLoginCount < maxFailedAttempts) return false;
    const lockMs = Math.min(lockoutBaseMs * 2 ** (failedLoginCount - maxFailedAttempts), lockoutMaxMs);
    await db.parentAccount.update({
      where: { id: accountId },
      data: { lockedUntil: new Date(at.getTime() + lockMs) },
    });
    return true;
  }

  async function sendCode(
    purpose: 'PASSWORD_RESET' | 'PHONE_CHANGE',
    account: { id: string; guardianId: string },
    to: string,
    lookupHash: string,
    binding: string,
    at: Date,
    meta: Meta,
  ): Promise<{ challengeId: string; expiresAt: Date; status: string }> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(at.getTime() + ttlMs);
    const challenge = await db.otpChallenge.create({
      data: {
        purpose,
        parentAccountId: account.id,
        phoneLookupHash: lookupHash,
        codeHash: codeHash(purpose, binding, code),
        expiresAt,
        maxAttempts: OTP_LIMITS.maxAttempts,
        createdAt: at,
      },
    });
    let result: Awaited<ReturnType<typeof parentPortal.sms.send>>;
    try {
      result = await parentPortal.sms.send({
        to,
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
        guardianId: account.guardianId,
        purpose: 'OTP',
        templateId: 'PARENT_OTP',
        maskedTo: maskPhone(to),
        status: result.status,
        provider: result.provider,
        providerMessageId: result.providerMessageId ?? null,
        error: result.error ?? null,
        createdAt: at,
        sentAt: result.status === 'SENT' ? at : null,
      },
    });
    await audit(
      `parent_otp.${purpose.toLowerCase()}_sent`,
      result.status === 'SENT' ? 'SUCCESS' : 'FAILED',
      meta,
      account.id,
      {
        challengeId: challenge.id,
        smsStatus: result.status,
      },
    );
    if (result.status !== 'SENT') logger.warn('parent_otp_sms_not_sent', { purpose, status: result.status });
    return { challengeId: challenge.id, expiresAt, status: result.status };
  }

  /**
   * Checks a code against the newest challenge: counts the attempt atomically first, then compares
   * in constant time, then consumes it once. Returns false for any failure.
   */
  async function useCode(challenge: OtpChallenge | null, expected: string, at: Date): Promise<boolean> {
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt.getTime() <= at.getTime() ||
      challenge.attempts >= challenge.maxAttempts
    ) {
      return false;
    }
    const counted = await db.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) return false;
    if (!timingSafeEqual(Buffer.from(challenge.codeHash, 'hex'), Buffer.from(expected, 'hex'))) return false;
    const consumed = await db.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: at },
    });
    return consumed.count === 1;
  }

  function checkNewPassword(password: string, phone: string) {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (password.replace(/\D/g, '').includes(digits)) {
      throw AppError.unprocessable('WEAK_PASSWORD', 'Password must not contain your mobile number', {
        reason: 'CONTAINS_PHONE',
      });
    }
    const violation = checkPasswordPolicy(password);
    if (violation)
      throw AppError.unprocessable('WEAK_PASSWORD', PASSWORD_POLICY_MESSAGES[violation], {
        reason: violation,
      });
  }

  return {
    accountDto,

    async login(
      meta: Meta,
      input: { phone: string; password: string; deviceLabel?: string | undefined },
    ): Promise<ParentTokensResponse> {
      const at = now();
      const account = await accountByPhone(input.phone);
      if (!account) {
        await verifyAgainstDummyHash(input.password);
        await audit('parent_auth.login', 'FAILED', meta, undefined, { reason: 'UNKNOWN_ACCOUNT' });
        throw invalidCredentials();
      }
      const passwordOk = await verifyPassword(account.passwordHash, input.password);
      if (account.lockedUntil && account.lockedUntil > at) {
        await audit('parent_auth.login', 'DENIED', meta, account.id, { reason: 'LOCKED' });
        throw invalidCredentials();
      }
      if (!passwordOk) {
        const locked = await registerFailedLogin(account.id, at);
        await audit('parent_auth.login', 'FAILED', meta, account.id, {
          reason: locked ? 'BAD_PASSWORD_LOCKED' : 'BAD_PASSWORD',
        });
        throw invalidCredentials();
      }
      if (account.status !== 'ACTIVE') {
        await audit('parent_auth.login', 'DENIED', meta, account.id, { reason: `ACCOUNT_${account.status}` });
        throw invalidCredentials();
      }
      const newHash = passwordNeedsRehash(account.passwordHash)
        ? await hashPassword(input.password)
        : undefined;
      const issued = await db.$transaction(async (tx) => {
        await tx.parentAccount.update({
          where: { id: account.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: at,
            ...(newHash && { passwordHash: newHash }),
          },
        });
        return createParentSessionFamily(tx, parentAuth.refresh, account.id, input.deviceLabel ?? null, at);
      });
      await audit('parent_auth.login', 'SUCCESS', meta, account.id, { familyId: issued.familyId });
      return tokens(issued, at);
    },

    async refresh(meta: Meta, refreshToken: string): Promise<ParentTokensResponse> {
      const at = now();
      const result = await rotateParentRefreshToken(db, parentAuth.refresh, refreshToken, at);
      if (result.kind === 'rotated') return tokens(result.issued, at);
      if (result.kind === 'reuse_detected') {
        await audit('parent_auth.refresh_reuse_detected', 'DENIED', meta, result.parentAccountId, {
          familyId: result.familyId,
        });
      }
      throw sessionExpired();
    },

    async logout(meta: Meta, refreshToken: string) {
      const family = await findParentFamilyByToken(db, refreshToken);
      if (!family) return;
      const count = await revokeParentFamily(db, family.familyId, REVOCATION_REASONS.logout, now());
      if (count > 0)
        await audit('parent_auth.logout', 'SUCCESS', meta, family.parentAccountId, {
          familyId: family.familyId,
        });
    },

    async logoutAll(meta: Meta, auth: ParentAuthContext) {
      const count = await revokeAllParentSessions(
        db,
        auth.parentAccountId,
        REVOCATION_REASONS.logoutAll,
        now(),
      );
      await audit('parent_auth.logout_all', 'SUCCESS', meta, auth.parentAccountId, {
        sessionsRevoked: count,
      });
    },

    async changePassword(
      meta: Meta,
      auth: ParentAuthContext,
      input: { currentPassword: string; newPassword: string },
    ): Promise<ParentTokensResponse> {
      const at = now();
      const account = await db.parentAccount.findUniqueOrThrow({
        where: { id: auth.parentAccountId },
        include: { guardian: { select: { id: true, phoneEncrypted: true } } },
      });
      if (!(await verifyPassword(account.passwordHash, input.currentPassword))) {
        await registerFailedLogin(account.id, at);
        await audit('parent_auth.password_change', 'FAILED', meta, account.id, {
          reason: 'WRONG_CURRENT_PASSWORD',
        });
        throw AppError.unprocessable('CURRENT_PASSWORD_WRONG', 'Your current password is not correct.');
      }
      const phone = account.guardian.phoneEncrypted
        ? pii.decryptPhone(account.guardian.phoneEncrypted, account.guardian.id)
        : '';
      checkNewPassword(input.newPassword, phone);
      if (await verifyPassword(account.passwordHash, input.newPassword)) {
        throw AppError.unprocessable('WEAK_PASSWORD', 'Choose a password different from the current one.', {
          reason: 'SAME_AS_CURRENT',
        });
      }
      const passwordHash = await hashPassword(input.newPassword);
      const issued = await db.$transaction(async (tx) => {
        await tx.parentAccount.update({
          where: { id: account.id },
          data: { passwordHash, passwordChangedAt: at, failedLoginCount: 0, lockedUntil: null },
        });
        await revokeAllParentSessions(tx, account.id, REVOCATION_REASONS.passwordChanged, at);
        return createParentSessionFamily(tx, parentAuth.refresh, account.id, null, at);
      });
      await audit('parent_auth.password_change', 'SUCCESS', meta, account.id);
      return tokens(issued, at);
    },

    async forgotPassword(meta: Meta, phone: string) {
      const at = now();
      // A missing provider or key affects everyone alike, so it may be reported (no enumeration).
      otpKey();
      if (!parentPortal.sms.configured) {
        throw new AppError(
          503,
          'SMS_NOT_CONFIGURED',
          'Codes cannot be sent by SMS yet. Contact your health worker.',
        );
      }
      const lookupHash = pii.phoneLookupHash(phone);
      const account = await accountByPhone(phone);
      if (!account) {
        await audit('parent_auth.reset_requested', 'FAILED', meta, undefined, { reason: 'UNKNOWN_ACCOUNT' });
        return { accepted: true as const, message: FORGOT_PASSWORD_MESSAGE };
      }
      const [latest, recent] = await Promise.all([
        db.otpChallenge.findFirst({
          where: { parentAccountId: account.id, purpose: 'PASSWORD_RESET' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        db.otpChallenge.count({
          where: {
            parentAccountId: account.id,
            purpose: 'PASSWORD_RESET',
            createdAt: { gt: new Date(at.getTime() - 60 * MINUTE) },
          },
        }),
      ]);
      if (
        (latest && at.getTime() - latest.createdAt.getTime() < OTP_LIMITS.resendAfterMs) ||
        recent >= CODES_PER_HOUR
      ) {
        // Silently skipped: the answer must not reveal that this number has an account.
        await audit('parent_auth.reset_requested', 'DENIED', meta, account.id, { reason: 'LIMIT' });
        return { accepted: true as const, message: FORGOT_PASSWORD_MESSAGE };
      }
      await sendCode('PASSWORD_RESET', account, phone, lookupHash, account.id, at, meta);
      return { accepted: true as const, message: FORGOT_PASSWORD_MESSAGE };
    },

    async resetPassword(meta: Meta, input: { phone: string; code: string; newPassword: string }) {
      const at = now();
      checkNewPassword(input.newPassword, input.phone);
      const account = await accountByPhone(input.phone);
      if (!account) {
        await audit('parent_auth.password_reset', 'FAILED', meta, undefined, { reason: 'UNKNOWN_ACCOUNT' });
        throw resetInvalid();
      }
      const challenge = await db.otpChallenge.findFirst({
        where: { parentAccountId: account.id, purpose: 'PASSWORD_RESET' },
        orderBy: { createdAt: 'desc' },
      });
      if (!(await useCode(challenge, codeHash('PASSWORD_RESET', account.id, input.code), at))) {
        await audit('parent_auth.password_reset', 'FAILED', meta, account.id, { reason: 'BAD_CODE' });
        throw resetInvalid();
      }
      const passwordHash = await hashPassword(input.newPassword);
      await db.$transaction(async (tx) => {
        await tx.parentAccount.update({
          where: { id: account.id },
          data: { passwordHash, passwordChangedAt: at, failedLoginCount: 0, lockedUntil: null },
        });
        await revokeAllParentSessions(tx, account.id, REVOCATION_REASONS.passwordReset, at);
      });
      await audit('parent_auth.password_reset', 'SUCCESS', meta, account.id);
      return { reset: true as const };
    },

    async startPhoneChange(
      meta: Meta,
      auth: ParentAuthContext,
      input: { newPhone: string; currentPassword: string },
    ): Promise<SendOtpResponse> {
      const at = now();
      otpKey();
      const account = await db.parentAccount.findUniqueOrThrow({ where: { id: auth.parentAccountId } });
      if (!(await verifyPassword(account.passwordHash, input.currentPassword))) {
        await registerFailedLogin(account.id, at);
        await audit('parent_auth.phone_change', 'FAILED', meta, account.id, {
          reason: 'WRONG_CURRENT_PASSWORD',
        });
        throw AppError.unprocessable('CURRENT_PASSWORD_WRONG', 'Your current password is not correct.');
      }
      const newHash = pii.phoneLookupHash(input.newPhone);
      if (newHash === account.phoneLookupHash) {
        throw AppError.unprocessable('SAME_PHONE', 'This is already your mobile number.');
      }
      const [latest, recent] = await Promise.all([
        db.otpChallenge.findFirst({
          where: { parentAccountId: account.id, purpose: 'PHONE_CHANGE' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        db.otpChallenge.count({
          where: {
            parentAccountId: account.id,
            purpose: 'PHONE_CHANGE',
            createdAt: { gt: new Date(at.getTime() - 60 * MINUTE) },
          },
        }),
      ]);
      if (latest && at.getTime() - latest.createdAt.getTime() < OTP_LIMITS.resendAfterMs) {
        throw new AppError(429, 'OTP_RESEND_TOO_SOON', 'Please wait a minute before asking for a new code.');
      }
      if (recent >= CODES_PER_HOUR)
        throw new AppError(429, 'OTP_LIMIT', 'Too many codes were requested. Try again later.');
      if (!parentPortal.sms.configured) {
        throw new AppError(
          503,
          'SMS_NOT_CONFIGURED',
          'Codes cannot be sent by SMS yet. Contact your health worker.',
        );
      }
      const sent = await sendCode(
        'PHONE_CHANGE',
        account,
        input.newPhone,
        newHash,
        `${account.id}:${newHash}`,
        at,
        meta,
      );
      if (sent.status !== 'SENT')
        throw new AppError(503, 'SMS_NOT_SENT', 'The code could not be sent. Try again in a few minutes.');
      return {
        sent: true,
        maskedPhone: maskPhone(input.newPhone),
        expiresAt: sent.expiresAt.toISOString(),
        resendAfter: new Date(at.getTime() + OTP_LIMITS.resendAfterMs).toISOString(),
      };
    },

    async confirmPhoneChange(
      meta: Meta,
      auth: ParentAuthContext,
      input: { newPhone: string; code: string },
    ): Promise<ParentAccountDto> {
      const at = now();
      const account = await db.parentAccount.findUniqueOrThrow({ where: { id: auth.parentAccountId } });
      const newHash = pii.phoneLookupHash(input.newPhone);
      const challenge = await db.otpChallenge.findFirst({
        where: { parentAccountId: account.id, purpose: 'PHONE_CHANGE' },
        orderBy: { createdAt: 'desc' },
      });
      const forThisNumber = challenge && challenge.phoneLookupHash === newHash ? challenge : null;
      if (
        !(await useCode(forThisNumber, codeHash('PHONE_CHANGE', `${account.id}:${newHash}`, input.code), at))
      ) {
        await audit('parent_auth.phone_change', 'FAILED', meta, account.id, { reason: 'BAD_CODE' });
        throw new AppError(400, 'OTP_INVALID', 'The code is not correct or has expired. Ask for a new code.');
      }
      try {
        await db.$transaction(async (tx) => {
          await tx.parentAccount.update({ where: { id: account.id }, data: { phoneLookupHash: newHash } });
          await tx.guardian.update({
            where: { id: account.guardianId },
            data: {
              phoneEncrypted: pii.encryptPhone(input.newPhone, account.guardianId),
              phoneLookupHash: newHash,
            },
          });
          // Other devices must sign in again with the new number.
          await revokeAllParentSessions(
            tx,
            account.id,
            REVOCATION_REASONS.sessionRevoked,
            at,
            auth.sessionId,
          );
          await recordAudit(tx, {
            actorParentAccountId: account.id,
            action: 'parent_auth.phone_changed',
            entityType: 'guardian',
            entityId: account.guardianId,
            outcome: 'SUCCESS',
            requestId: meta.requestId,
            details: { to: maskPhone(input.newPhone) },
          });
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw AppError.conflict('PHONE_IN_USE', 'Another Parent Portal account already uses this number.');
        }
        throw error;
      }
      return accountDto(account.id);
    },
  };
}
