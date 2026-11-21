import type { Prisma, PrismaClient } from '@prisma/client';
import type { Db } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { recordAudit } from '../audit/audit.service';
import type { PermissionCode } from './permissions';

/**
 * Server-side area-scoped access control (docs/database-design.md section 5,
 * docs/authorization.md).
 *
 * EVERY query that returns child-linked data must include one of the `...ScopeWhere(...)`
 * filters below. Coverage is evaluated in the database through the AreaClosure table (an EXISTS
 * join), never by loading the list of accessible areas into memory.
 */
export type { Db };

export interface AccessContext {
  userId: string;
  requestId?: string;
  /** Evaluation time; defaults to now. Injectable for tests. */
  at?: Date;
  /**
   * Client used to write DENIED audit rows. Required when `db` is a transaction client: an audit
   * row written inside a transaction would be rolled back together with the failed operation.
   */
  auditDb?: PrismaClient;
}

/**
 * An assignment that is effective at `at`, belongs to an ACTIVE user and has an active role
 * (rules R1, R5, R8). With `permission`, the role must also grant it.
 */
export function effectiveAssignmentWhere(
  userId: string,
  permission: PermissionCode | null,
  at: Date,
  extra: Prisma.WorkerAreaAssignmentWhereInput = {},
): Prisma.WorkerAreaAssignmentWhereInput {
  return {
    userId,
    status: 'ACTIVE',
    effectiveFrom: { lte: at },
    user: { status: 'ACTIVE' },
    role: {
      isActive: true,
      ...(permission && { permissions: { some: { permission: { code: permission } } } }),
    },
    // AND, never a spread: `extra` may contain its own OR / scope keys, and a spread would
    // silently replace the end-date condition.
    AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, extra],
  };
}

/**
 * Areas covered by the user's effective assignments that grant `permission` (R2-R4):
 *  - AREA_ONLY covers only the assigned area itself (closure self link, depth 0);
 *  - AREA_AND_DESCENDANTS covers the assigned area and everything below it.
 */
export function areaScopeWhere(
  userId: string,
  permission: PermissionCode,
  at: Date = new Date(),
): Prisma.AreaWhereInput {
  return {
    ancestorLinks: {
      some: {
        OR: [
          {
            depth: 0,
            ancestor: { assignments: { some: effectiveAssignmentWhere(userId, permission, at) } },
          },
          {
            ancestor: {
              assignments: {
                some: effectiveAssignmentWhere(userId, permission, at, { scope: 'AREA_AND_DESCENDANTS' }),
              },
            },
          },
        ],
      },
    },
  };
}

/**
 * Assignments (of anyone) that cover `areaId`. With `wholeSubtree`, only assignments that also
 * cover every area below it (AREA_AND_DESCENDANTS at the area or an ancestor).
 */
export function assignmentCoversAreaWhere(
  areaId: string,
  wholeSubtree = false,
): Prisma.WorkerAreaAssignmentWhereInput {
  const descendantScope: Prisma.WorkerAreaAssignmentWhereInput = {
    scope: 'AREA_AND_DESCENDANTS',
    area: { descendantLinks: { some: { descendantId: areaId } } },
  };
  return wholeSubtree ? descendantScope : { OR: [{ areaId }, descendantScope] };
}

// --------------------------------------------------------------- child and child-linked data

/**
 * Children whose CURRENT area is covered (decision D4: access follows the child; the area
 * snapshots on sessions and referrals are for reporting history only, never for access).
 * Soft-deleted children are excluded.
 */
export function childScopeWhere(
  userId: string,
  permission: PermissionCode,
  at: Date = new Date(),
): Prisma.ChildWhereInput {
  return { deletedAt: null, area: areaScopeWhere(userId, permission, at) };
}

/** R6: every child-linked record is reachable only through an accessible child. */
export const scopedWhere = {
  /** Guardians linked to an accessible child through a current (not ended) relationship. */
  guardian: (userId: string, permission: PermissionCode, at = new Date()): Prisma.GuardianWhereInput => ({
    deletedAt: null,
    children: { some: { endedAt: null, child: childScopeWhere(userId, permission, at) } },
  }),
  consent: (userId: string, permission: PermissionCode, at = new Date()): Prisma.ConsentWhereInput => ({
    child: childScopeWhere(userId, permission, at),
  }),
  screeningSession: (
    userId: string,
    permission: PermissionCode,
    at = new Date(),
  ): Prisma.ScreeningSessionWhereInput => ({ child: childScopeWhere(userId, permission, at) }),
  screeningObservation: (
    userId: string,
    permission: PermissionCode,
    at = new Date(),
  ): Prisma.ScreeningObservationWhereInput => ({
    session: { child: childScopeWhere(userId, permission, at) },
  }),
  measurement: (
    userId: string,
    permission: PermissionCode,
    at = new Date(),
  ): Prisma.MeasurementWhereInput => ({
    child: childScopeWhere(userId, permission, at),
  }),
  screeningResult: (
    userId: string,
    permission: PermissionCode,
    at = new Date(),
  ): Prisma.ScreeningResultWhereInput => ({ session: { child: childScopeWhere(userId, permission, at) } }),
  aiAnalysis: (userId: string, permission: PermissionCode, at = new Date()): Prisma.AiAnalysisWhereInput => ({
    session: { child: childScopeWhere(userId, permission, at) },
  }),
  referral: (userId: string, permission: PermissionCode, at = new Date()): Prisma.ReferralWhereInput => ({
    child: childScopeWhere(userId, permission, at),
  }),
  followUp: (userId: string, permission: PermissionCode, at = new Date()): Prisma.FollowUpWhereInput => ({
    child: childScopeWhere(userId, permission, at),
  }),
  media: (userId: string, permission: PermissionCode, at = new Date()): Prisma.MediaMetadataWhereInput => ({
    deletedAt: null,
    child: childScopeWhere(userId, permission, at),
  }),
  childTransfer: (
    userId: string,
    permission: PermissionCode,
    at = new Date(),
  ): Prisma.ChildAreaTransferWhereInput => ({ child: childScopeWhere(userId, permission, at) }),
};

/** 'childGuardian': a link id checked through its child (always verified as a chain). */
export type ScopedEntity = keyof typeof scopedWhere | 'child' | 'childGuardian';

function isRootClient(db: Db): db is PrismaClient {
  return '$transaction' in db;
}

/**
 * Records an access denial and returns the 404 to throw (R11: "outside your scope" and "does
 * not exist" look identical). `recordExists` is for the audit trail only (IDOR probing).
 */
export async function denyAsNotFound(
  db: Db,
  ctx: AccessContext,
  entity: ScopedEntity,
  entityId: string,
  permission: PermissionCode,
  recordExists: boolean,
  message = 'Resource not found',
): Promise<AppError> {
  const auditDb = ctx.auditDb ?? (isRootClient(db) ? db : null);
  if (!auditDb) {
    // Programming error: the denial would be rolled back with the transaction and lost.
    throw new Error('AccessContext.auditDb is required when access checks run inside a transaction');
  }
  await recordAudit(auditDb, {
    actorUserId: ctx.userId,
    action: `${entity}.access_denied`,
    entityType: entity,
    entityId: recordExists ? entityId : undefined,
    outcome: 'DENIED',
    requestId: ctx.requestId,
    details: { permission, recordExists },
  });
  return AppError.notFound(message);
}

/**
 * Loads a child only if the user may use `permission` on it. Otherwise records a DENIED audit
 * event and throws 404 - the same response as for a non-existent child (R11).
 */
export async function findChildOrDeny(
  db: Db,
  ctx: AccessContext,
  childId: string,
  permission: PermissionCode,
) {
  const child = await db.child.findFirst({
    where: { id: childId, ...childScopeWhere(ctx.userId, permission, ctx.at) },
  });
  if (child) return child;
  const exists = (await db.child.count({ where: { id: childId } })) > 0;
  throw await denyAsNotFound(db, ctx, 'child', childId, permission, exists, 'Child not found');
}

/**
 * Generic single-record check for any child-linked entity: returns true when the record exists
 * AND is in scope; otherwise audits and throws 404. Use before loading or changing the record.
 */
export async function assertInScopeOrDeny(
  db: Db,
  ctx: AccessContext,
  entity: keyof typeof scopedWhere,
  id: string,
  permission: PermissionCode,
): Promise<void> {
  const at = ctx.at ?? new Date();
  const counts = await scopedCount(db, entity, id, ctx.userId, permission, at);
  if (counts.inScope > 0) return;
  throw await denyAsNotFound(db, ctx, entity, id, permission, counts.exists > 0);
}

async function scopedCount(
  db: Db,
  entity: keyof typeof scopedWhere,
  id: string,
  userId: string,
  permission: PermissionCode,
  at: Date,
): Promise<{ inScope: number; exists: number }> {
  switch (entity) {
    case 'guardian':
      return {
        inScope: await db.guardian.count({ where: { id, ...scopedWhere.guardian(userId, permission, at) } }),
        exists: await db.guardian.count({ where: { id } }),
      };
    case 'consent':
      return {
        inScope: await db.consent.count({ where: { id, ...scopedWhere.consent(userId, permission, at) } }),
        exists: await db.consent.count({ where: { id } }),
      };
    case 'screeningSession':
      return {
        inScope: await db.screeningSession.count({
          where: { id, ...scopedWhere.screeningSession(userId, permission, at) },
        }),
        exists: await db.screeningSession.count({ where: { id } }),
      };
    case 'screeningObservation':
      return {
        inScope: await db.screeningObservation.count({
          where: { id, ...scopedWhere.screeningObservation(userId, permission, at) },
        }),
        exists: await db.screeningObservation.count({ where: { id } }),
      };
    case 'measurement':
      return {
        inScope: await db.measurement.count({
          where: { id, ...scopedWhere.measurement(userId, permission, at) },
        }),
        exists: await db.measurement.count({ where: { id } }),
      };
    case 'screeningResult':
      return {
        inScope: await db.screeningResult.count({
          where: { id, ...scopedWhere.screeningResult(userId, permission, at) },
        }),
        exists: await db.screeningResult.count({ where: { id } }),
      };
    case 'aiAnalysis':
      return {
        inScope: await db.aiAnalysis.count({
          where: { id, ...scopedWhere.aiAnalysis(userId, permission, at) },
        }),
        exists: await db.aiAnalysis.count({ where: { id } }),
      };
    case 'referral':
      return {
        inScope: await db.referral.count({ where: { id, ...scopedWhere.referral(userId, permission, at) } }),
        exists: await db.referral.count({ where: { id } }),
      };
    case 'followUp':
      return {
        inScope: await db.followUp.count({ where: { id, ...scopedWhere.followUp(userId, permission, at) } }),
        exists: await db.followUp.count({ where: { id } }),
      };
    case 'media':
      return {
        inScope: await db.mediaMetadata.count({
          where: { id, ...scopedWhere.media(userId, permission, at) },
        }),
        exists: await db.mediaMetadata.count({ where: { id } }),
      };
    case 'childTransfer':
      return {
        inScope: await db.childAreaTransfer.count({
          where: { id, ...scopedWhere.childTransfer(userId, permission, at) },
        }),
        exists: await db.childAreaTransfer.count({ where: { id } }),
      };
  }
}

/** Aggregate count for reports: never returns individual rows (R7). */
export function countChildrenInScope(db: Db, ctx: AccessContext): Promise<number> {
  return db.child.count({ where: childScopeWhere(ctx.userId, 'report.aggregate', ctx.at) });
}
