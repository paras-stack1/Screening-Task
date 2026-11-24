import { createHash, randomBytes } from 'node:crypto';
import type {
  CreateParentInvitationRequest,
  ParentInvitationStatus,
  ParentPortalStatus,
  RevokeParentInvitationRequest,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { maskPhone, type SmsSender } from '../../integrations/sms/smsSender';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { childScopeWhere, type AccessContext } from '../access-control/accessScope';
import { recordAudit } from '../audit/audit.service';

export interface ParentPortalSettings {
  /** Trusted address of the Parent Portal; empty = not configured (no invitations). */
  portalUrl: string;
  inviteTtlHours: number;
  sms: SmsSender;
  /** Rate limits (assumptions, PP5). */
  maxInvitationsPerGuardianPerDay?: number;
  maxInvitationsPerWorkerPerHour?: number;
}

export interface InvitationServiceDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  parentPortal: ParentPortalSettings;
}

const HOUR = 3_600_000;
export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * Worker side of Parent Portal onboarding (Step 8 stage 3; PP4, PP5, PP7, PP11, PP17).
 *
 * - Only `guardian.invite` holders, for a guardian linked (active link) to a child in their area.
 * - The token: 32 random bytes, base64url, only its SHA-256 stored, never logged or returned;
 *   the link puts it after "#" so it never reaches server logs. Single use, expires, and a new
 *   invitation revokes the guardian's older open one (also a database rule).
 * - The worker confirms which children the guardian may see: PENDING access rows, activated
 *   only when the parent activates the account (stage 4).
 * - SMS is sent after commit through the configured sender; without a provider the invitation
 *   stays INVITATION_PENDING ("SMS not configured") - nothing is reported as sent.
 */
export function createInvitationService({ db, pii, parentPortal }: InvitationServiceDependencies) {
  const at = (ctx: AccessContext) => ctx.at ?? new Date();
  const perGuardianPerDay = parentPortal.maxInvitationsPerGuardianPerDay ?? 3;
  const perWorkerPerHour = parentPortal.maxInvitationsPerWorkerPerHour ?? 30;

  /** The guardian, if linked (active link) to a child in the caller's scope for `permission`. */
  async function guardianInScope(
    ctx: AccessContext,
    guardianId: string,
    permission: 'child.read' | 'guardian.invite',
  ) {
    return db.guardian.findFirst({
      where: {
        id: guardianId,
        deletedAt: null,
        children: { some: { endedAt: null, child: childScopeWhere(ctx.userId, permission, at(ctx)) } },
      },
    });
  }

  async function notFound(ctx: AccessContext, guardianId: string, action: string) {
    const exists = (await db.guardian.count({ where: { id: guardianId } })) > 0;
    await recordAudit(db, {
      actorUserId: ctx.userId,
      action: 'parent_invitation.access_denied',
      entityType: 'guardian',
      entityId: exists ? guardianId : undefined,
      outcome: 'DENIED',
      requestId: ctx.requestId,
      details: { action, recordExists: exists },
    });
    return AppError.notFound('Guardian not found');
  }

  function phoneOf(g: { id: string; phoneEncrypted: Uint8Array | null }): string | null {
    if (!g.phoneEncrypted) return null;
    return pii.decryptPhone(g.phoneEncrypted, g.id);
  }

  function effectiveStatus(
    latest: { status: string; expiresAt: Date } | null,
    activated: boolean,
    now: Date,
  ): ParentInvitationStatus {
    if (activated) return 'ACTIVATED';
    if (!latest) return 'NOT_INVITED';
    if (latest.status === 'REVOKED') return 'REVOKED';
    if (latest.status === 'USED') return 'ACTIVATED';
    if (latest.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
    return latest.status === 'SENT' ? 'INVITATION_SENT' : 'INVITATION_PENDING';
  }

  async function status(ctx: AccessContext, guardianId: string): Promise<ParentPortalStatus> {
    const g = await guardianInScope(ctx, guardianId, 'child.read');
    if (!g) throw await notFound(ctx, guardianId, 'status');
    const now = at(ctx);
    const [account, latest, links, canInviteScope] = await Promise.all([
      db.parentAccount.findUnique({ where: { guardianId }, select: { status: true } }),
      db.parentInvitation.findFirst({
        where: { guardianId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { createdBy: { select: { displayName: true } } },
      }),
      db.childGuardian.findMany({
        where: { guardianId, endedAt: null, child: childScopeWhere(ctx.userId, 'child.read', now) },
        include: {
          child: { select: { id: true, fullName: true } },
          parentAccess: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      guardianInScope(ctx, guardianId, 'guardian.invite'),
    ]);
    const sms = latest
      ? await db.smsMessage.findFirst({
          where: { guardianId, purpose: 'INVITATION', createdAt: { gte: latest.createdAt } },
          orderBy: { createdAt: 'desc' },
          select: { status: true },
        })
      : null;
    const phone = phoneOf(g);
    const activated = account !== null && account.status !== 'DISABLED';
    const blockedReason = !canInviteScope
      ? 'NOT_ALLOWED'
      : !phone
        ? 'NO_PHONE'
        : activated
          ? 'ALREADY_ACTIVATED'
          : null;
    return {
      guardianId,
      guardianName: g.fullName,
      status: effectiveStatus(latest, activated, now),
      maskedPhone: phone ? maskPhone(phone) : null,
      latestInvitation: latest
        ? {
            id: latest.id,
            createdAt: latest.createdAt.toISOString(),
            expiresAt: latest.expiresAt.toISOString(),
            sentAt: latest.sentAt?.toISOString() ?? null,
            createdByName: latest.createdBy.displayName,
            smsStatus: sms?.status ?? null,
            revokedReason: latest.revokedReason,
          }
        : null,
      children: links.map((l) => ({
        childId: l.child.id,
        childName: l.child.fullName,
        relationship: l.relationship,
        access: l.parentAccess[0]?.status ?? 'NONE',
      })),
      canInvite: blockedReason === null,
      blockedReason,
    };
  }

  return {
    status,

    async create(
      ctx: AccessContext,
      guardianId: string,
      body: CreateParentInvitationRequest,
    ): Promise<ParentPortalStatus> {
      const now = at(ctx);
      const g = await guardianInScope(ctx, guardianId, 'guardian.invite');
      if (!g) throw await notFound(ctx, guardianId, 'create');
      if (!parentPortal.portalUrl) {
        throw new AppError(
          503,
          'PARENT_PORTAL_NOT_CONFIGURED',
          'The Parent Portal address is not configured yet.',
        );
      }
      const phone = phoneOf(g);
      if (!phone || !g.phoneLookupHash) {
        throw AppError.unprocessable(
          'GUARDIAN_PHONE_MISSING',
          'Record the guardian mobile number before inviting.',
        );
      }
      const account = await db.parentAccount.findUnique({ where: { guardianId }, select: { status: true } });
      if (account && account.status !== 'DISABLED') {
        throw AppError.conflict(
          'ALREADY_ACTIVATED',
          'This guardian already has an active Parent Portal account.',
        );
      }
      // Every chosen child must be an active link of THIS guardian, in the caller's area.
      const childIds = [...new Set(body.childIds)];
      const links = await db.childGuardian.findMany({
        where: {
          guardianId,
          endedAt: null,
          childId: { in: childIds },
          child: childScopeWhere(ctx.userId, 'guardian.invite', now),
        },
        select: { id: true, childId: true },
      });
      if (links.length !== childIds.length) {
        throw AppError.unprocessable(
          'CHILD_NOT_LINKED',
          'Choose only children linked to this guardian in your area.',
        );
      }
      const [forGuardian, byWorker] = await Promise.all([
        db.parentInvitation.count({
          where: { guardianId, createdAt: { gt: new Date(now.getTime() - 24 * HOUR) } },
        }),
        db.parentInvitation.count({
          where: { createdById: ctx.userId, createdAt: { gt: new Date(now.getTime() - HOUR) } },
        }),
      ]);
      if (forGuardian >= perGuardianPerDay || byWorker >= perWorkerPerHour) {
        throw new AppError(429, 'INVITATION_LIMIT', 'Too many invitations. Try again later.');
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + parentPortal.inviteTtlHours * HOUR);
      const invitationId = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Guardian" WHERE id = ${guardianId}::uuid FOR UPDATE`;
        await tx.parentInvitation.updateMany({
          where: { guardianId, status: { in: ['PENDING', 'SENT'] } },
          data: { status: 'REVOKED', revokedAt: now, revokedReason: 'Replaced by a new invitation' },
        });
        // Children confirmed now replace any earlier, not yet activated choice.
        await tx.guardianChildAccess.updateMany({
          where: { guardianId, status: 'PENDING' },
          data: {
            status: 'REVOKED',
            revokedAt: now,
            revokedById: ctx.userId,
            revokeReason: 'Replaced by a new invitation',
          },
        });
        const inv = await tx.parentInvitation.create({
          data: {
            guardianId,
            tokenHash: hashToken(token),
            expiresAt,
            phoneLookupHash: g.phoneLookupHash!,
            createdById: ctx.userId,
            // The request clock, so the rate-limit windows and expiry use one time source.
            createdAt: now,
          },
        });
        for (const link of links) {
          await tx.guardianChildAccess.create({
            data: {
              childGuardianId: link.id,
              guardianId,
              childId: link.childId,
              grantedById: ctx.userId,
              grantedAt: now,
            },
          });
        }
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: 'parent_invitation.created',
          entityType: 'guardian',
          entityId: guardianId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: {
            invitationId: inv.id,
            childIds: links.map((l) => l.childId),
            expiresAt: expiresAt.toISOString(),
            to: maskPhone(phone),
          },
        });
        return inv.id;
      });

      // After commit: send. A failure is recorded and never undoes the invitation.
      let result: Awaited<ReturnType<SmsSender['send']>>;
      try {
        result = await parentPortal.sms.send({
          to: phone,
          templateId: 'PARENT_INVITATION',
          params: {
            link: `${parentPortal.portalUrl}/invite#${token}`,
            hours: String(parentPortal.inviteTtlHours),
          },
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
          guardianId,
          purpose: 'INVITATION',
          createdAt: now,
          templateId: 'PARENT_INVITATION',
          maskedTo: maskPhone(phone),
          status: result.status,
          provider: result.provider,
          providerMessageId: result.providerMessageId ?? null,
          error: result.error ?? null,
          sentAt: result.status === 'SENT' ? now : null,
        },
      });
      if (result.status === 'SENT') {
        await db.parentInvitation.updateMany({
          where: { id: invitationId, status: 'PENDING' },
          data: { status: 'SENT', sentAt: now },
        });
      } else {
        logger.warn('parent_invitation_sms_not_sent', { invitationId, status: result.status });
      }
      await recordAudit(db, {
        actorUserId: ctx.userId,
        action: 'parent_invitation.sms',
        entityType: 'guardian',
        entityId: guardianId,
        outcome: result.status === 'SENT' ? 'SUCCESS' : 'FAILED',
        requestId: ctx.requestId,
        details: { invitationId, smsStatus: result.status, provider: result.provider },
      });
      return status(ctx, guardianId);
    },

    async revoke(
      ctx: AccessContext,
      guardianId: string,
      invitationId: string,
      body: RevokeParentInvitationRequest,
    ) {
      const g = await guardianInScope(ctx, guardianId, 'guardian.invite');
      if (!g) throw await notFound(ctx, guardianId, 'revoke');
      const now = at(ctx);
      await db.$transaction(async (tx) => {
        const updated = await tx.parentInvitation.updateMany({
          where: { id: invitationId, guardianId, status: { in: ['PENDING', 'SENT'] } },
          data: { status: 'REVOKED', revokedAt: now, revokedReason: body.reason },
        });
        if (updated.count === 0)
          throw AppError.conflict('INVITATION_NOT_OPEN', 'This invitation is no longer open.');
        await tx.guardianChildAccess.updateMany({
          where: { guardianId, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: now, revokedById: ctx.userId, revokeReason: body.reason },
        });
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: 'parent_invitation.revoked',
          entityType: 'guardian',
          entityId: guardianId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: { invitationId },
        });
      });
      return status(ctx, guardianId);
    },
  };
}
