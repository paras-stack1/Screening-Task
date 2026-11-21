import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { recordAudit } from '../audit/audit.service';
import type { PermissionCode } from './permissions';

/**
 * Server-side area-scoped access control (docs/database-design.md section 5).
 *
 * EVERY query that returns child-linked data must include `childScopeWhere(...)`. Coverage is
 * evaluated in the database through the AreaClosure table (an EXISTS join), never by loading
 * the list of accessible areas into memory.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface AccessContext {
  userId: string;
  requestId?: string;
  /** Evaluation time; defaults to now. Injectable for tests. */
  at?: Date;
}

/**
 * An assignment that is effective at `at`, belongs to an ACTIVE user, has an active role, and
 * whose role grants `permission` (rules R1, R5, R8).
 */
export function effectiveAssignmentWhere(
  userId: string,
  permission: PermissionCode,
  at: Date,
  extra: Prisma.WorkerAreaAssignmentWhereInput = {},
): Prisma.WorkerAreaAssignmentWhereInput {
  return {
    userId,
    status: 'ACTIVE',
    effectiveFrom: { lte: at },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    user: { status: 'ACTIVE' },
    role: { isActive: true, permissions: { some: { permission: { code: permission } } } },
    ...extra,
  };
}

/**
 * Children whose current area is covered by one of the user's effective assignments (R2-R4):
 *  - AREA_ONLY covers only the assigned area itself (closure self link, depth 0);
 *  - AREA_AND_DESCENDANTS covers the assigned area and everything below it.
 * Soft-deleted children are excluded.
 */
export function childScopeWhere(
  userId: string,
  permission: PermissionCode,
  at: Date = new Date(),
): Prisma.ChildWhereInput {
  return {
    deletedAt: null,
    area: {
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
    },
  };
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

  // Distinguishing "exists but out of scope" is for the audit trail only (e.g. IDOR probing).
  const exists = (await db.child.count({ where: { id: childId } })) > 0;
  await recordAudit(db, {
    actorUserId: ctx.userId,
    action: 'child.access_denied',
    entityType: 'Child',
    entityId: exists ? childId : undefined,
    outcome: 'DENIED',
    requestId: ctx.requestId,
    details: { permission, recordExists: exists },
  });
  throw AppError.notFound('Child not found');
}

/** Aggregate count for reports: never returns individual rows (R7). */
export function countChildrenInScope(db: Db, ctx: AccessContext): Promise<number> {
  return db.child.count({ where: childScopeWhere(ctx.userId, 'report.aggregate', ctx.at) });
}
