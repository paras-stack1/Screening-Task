import type { AssignmentView, CreateAssignmentRequest, NewAssignment } from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient, type WorkerAreaAssignment } from '@prisma/client';
import type { Db } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { checkDelegation, type DelegationDenial } from '../access-control/authorization.service';
import type { PermissionCode } from '../access-control/permissions';
import { recordAudit } from '../audit/audit.service';

/**
 * Worker area assignments (design section 4.3/4.4). Assignments are never edited in place:
 * area, role, scope and start are immutable; only the end date can be shortened and the status
 * changed. Every change and every refusal is audited.
 */
export interface AdminContext {
  actorId: string;
  requestId?: string;
  at: Date;
}

/** Allowed clock skew for "effectiveFrom must not be in the past". */
const BACKDATE_TOLERANCE_MS = 60_000;

const viewSelect = {
  id: true,
  userId: true,
  areaId: true,
  roleId: true,
  scope: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  area: { select: { nameEn: true } },
  role: { select: { code: true } },
} satisfies Prisma.WorkerAreaAssignmentSelect;

export function toAssignmentView(
  row: Prisma.WorkerAreaAssignmentGetPayload<{ select: typeof viewSelect }>,
): AssignmentView {
  return {
    id: row.id,
    userId: row.userId,
    areaId: row.areaId,
    areaName: row.area.nameEn,
    roleId: row.roleId,
    roleCode: row.role.code,
    scope: row.scope,
    status: row.status,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
  };
}
export { viewSelect as assignmentViewSelect };

/** Audits a refused administrative action and returns the error to throw. */
export async function denyAdmin(
  db: PrismaClient,
  ctx: AdminContext,
  action: string,
  entityType: string,
  entityId: string | undefined,
  rule: DelegationDenial | 'OUT_OF_SCOPE' | 'NOT_FOUND',
): Promise<AppError> {
  await recordAudit(db, {
    actorUserId: ctx.actorId,
    action,
    entityType,
    entityId,
    outcome: 'DENIED',
    requestId: ctx.requestId,
    details: { rule },
  });
  if (rule === 'SELF_MODIFICATION') {
    return AppError.forbidden('SELF_MODIFICATION', 'You cannot change your own access or account status');
  }
  if (rule === 'OUT_OF_SCOPE' || rule === 'NOT_FOUND' || rule === 'MISSING_MANAGE_PERMISSION') {
    return AppError.forbidden('OUT_OF_SCOPE', 'This area or user is outside your administrative scope');
  }
  if (rule === 'ROLE_INACTIVE') return AppError.badRequest('This role is not active');
  return AppError.forbidden('ROLE_EXCEEDS_OWN_PERMISSIONS', 'You cannot grant permissions you do not hold');
}

function isOverlapError(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError) &&
    error.message.includes('assignment_no_overlap')
  );
}

/** Validates dates for a new assignment. Returns [from, to]. */
function assignmentPeriod(input: NewAssignment, at: Date): [Date, Date | null] {
  const from = input.effectiveFrom ? new Date(input.effectiveFrom) : at;
  const to = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (from.getTime() < at.getTime() - BACKDATE_TOLERANCE_MS) {
    throw AppError.badRequest('effectiveFrom cannot be in the past (history is never rewritten)');
  }
  if (to && to <= from) throw AppError.badRequest('effectiveTo must be after effectiveFrom');
  return [from, to];
}

/**
 * Checks and inserts one assignment inside `tx`. `managePermission` is the permission the
 * actor needs over the area: assignment.manage for an existing user, and additionally
 * user.manage when the account is being created (checked by the caller).
 */
export async function insertAssignment(
  tx: Db,
  auditDb: PrismaClient,
  ctx: AdminContext,
  targetUserId: string,
  input: NewAssignment,
  managePermission: PermissionCode,
): Promise<WorkerAreaAssignment> {
  const [from, to] = assignmentPeriod(input, ctx.at);

  const area = await tx.area.findUnique({ where: { id: input.areaId }, select: { isActive: true } });
  if (!area) throw await denyAdmin(auditDb, ctx, 'assignment.denied', 'Area', undefined, 'NOT_FOUND');

  const denial = await checkDelegation(tx, {
    actorId: ctx.actorId,
    targetUserId,
    areaId: input.areaId,
    roleId: input.roleId,
    scope: input.scope,
    managePermission,
    at: ctx.at,
  });
  if (denial) throw await denyAdmin(auditDb, ctx, 'assignment.denied', 'User', targetUserId, denial);
  if (!area.isActive) throw AppError.badRequest('Area is deactivated');

  try {
    return await tx.workerAreaAssignment.create({
      data: {
        userId: targetUserId,
        areaId: input.areaId,
        roleId: input.roleId,
        scope: input.scope,
        effectiveFrom: from,
        effectiveTo: to,
        reason: input.reason,
        createdById: ctx.actorId,
      },
    });
  } catch (error) {
    if (isOverlapError(error)) {
      throw new AppError(
        409,
        'ASSIGNMENT_OVERLAP',
        'The user already has this role in this area for an overlapping period',
      );
    }
    throw error;
  }
}

type StatusAction = 'suspend' | 'reactivate' | 'revoke';
const TRANSITIONS: Record<
  StatusAction,
  { from: Array<'ACTIVE' | 'SUSPENDED'>; to: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' }
> = {
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
  reactivate: { from: ['SUSPENDED'], to: 'ACTIVE' },
  revoke: { from: ['ACTIVE', 'SUSPENDED'], to: 'REVOKED' },
};

export function createAssignmentsService(db: PrismaClient) {
  /**
   * Loads an assignment the actor may change. Out of the actor's scope -> 404 (does not reveal
   * other areas' assignments); own assignment or role above the actor's -> 403. All audited.
   */
  async function loadManageable(ctx: AdminContext, assignmentId: string) {
    const row = await db.workerAreaAssignment.findUnique({ where: { id: assignmentId } });
    if (!row) throw AppError.notFound('Assignment not found');
    const denial = await checkDelegation(db, {
      actorId: ctx.actorId,
      targetUserId: row.userId,
      areaId: row.areaId,
      roleId: row.roleId,
      scope: row.scope,
      managePermission: 'assignment.manage',
      at: ctx.at,
    });
    if (denial === 'MISSING_MANAGE_PERMISSION') {
      await denyAdmin(db, ctx, 'assignment.denied', 'WorkerAreaAssignment', row.id, 'OUT_OF_SCOPE');
      throw AppError.notFound('Assignment not found');
    }
    // An inactive role grants nothing, so managing (ending/revoking) it is not an escalation.
    if (denial && denial !== 'ROLE_INACTIVE') {
      throw await denyAdmin(db, ctx, 'assignment.denied', 'WorkerAreaAssignment', row.id, denial);
    }
    return row;
  }

  async function view(id: string): Promise<AssignmentView> {
    return toAssignmentView(
      await db.workerAreaAssignment.findUniqueOrThrow({ where: { id }, select: viewSelect }),
    );
  }

  return {
    async create(ctx: AdminContext, input: CreateAssignmentRequest): Promise<AssignmentView> {
      const target = await db.user.findUnique({ where: { id: input.userId }, select: { status: true } });
      if (!target) throw AppError.notFound('User not found');
      if (target.status === 'DEACTIVATED') throw AppError.badRequest('User account is deactivated');

      const { userId, ...assignment } = input;
      const created = await db.$transaction(async (tx) => {
        const row = await insertAssignment(tx, db, ctx, userId, assignment, 'assignment.manage');
        await recordAudit(tx, {
          actorUserId: ctx.actorId,
          action: 'assignment.created',
          entityType: 'WorkerAreaAssignment',
          entityId: row.id,
          areaId: row.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: {
            userId: row.userId,
            areaId: row.areaId,
            roleId: row.roleId,
            scope: row.scope,
            effectiveFrom: row.effectiveFrom.toISOString(),
            effectiveTo: row.effectiveTo?.toISOString() ?? null,
            reason: row.reason,
          },
        });
        return row;
      });
      return view(created.id);
    },

    /** Ends an assignment (sets or shortens effectiveTo). Never extends one. */
    async end(ctx: AdminContext, assignmentId: string, input: { effectiveTo?: string; reason: string }) {
      const row = await loadManageable(ctx, assignmentId);
      const newEnd = input.effectiveTo ? new Date(input.effectiveTo) : ctx.at;
      if (row.status === 'REVOKED') throw new AppError(409, 'INVALID_TRANSITION', 'Assignment is revoked');
      if (newEnd <= row.effectiveFrom) {
        throw AppError.badRequest('The assignment has not started by then: revoke it instead');
      }
      if (newEnd.getTime() < ctx.at.getTime() - BACKDATE_TOLERANCE_MS) {
        throw AppError.badRequest('effectiveTo cannot be in the past (history is never rewritten)');
      }
      if (row.effectiveTo && newEnd >= row.effectiveTo) {
        throw AppError.badRequest('An assignment can only be shortened, not extended');
      }
      await db.$transaction(async (tx) => {
        const updated = await tx.workerAreaAssignment.updateMany({
          where: { id: row.id, effectiveTo: row.effectiveTo, status: row.status },
          data: {
            effectiveTo: newEnd,
            statusChangedById: ctx.actorId,
            statusChangedAt: ctx.at,
            statusChangeReason: input.reason,
          },
        });
        if (updated.count !== 1)
          throw new AppError(409, 'CONCURRENT_CHANGE', 'Assignment changed meanwhile; reload');
        await recordAudit(tx, {
          actorUserId: ctx.actorId,
          action: 'assignment.ended',
          entityType: 'WorkerAreaAssignment',
          entityId: row.id,
          areaId: row.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: {
            previousEffectiveTo: row.effectiveTo?.toISOString() ?? null,
            effectiveTo: newEnd.toISOString(),
            reason: input.reason,
          },
        });
      });
      return view(row.id);
    },

    async changeStatus(ctx: AdminContext, assignmentId: string, action: StatusAction, reason: string) {
      const row = await loadManageable(ctx, assignmentId);
      const transition = TRANSITIONS[action];
      if (!transition.from.includes(row.status as 'ACTIVE' | 'SUSPENDED')) {
        throw new AppError(409, 'INVALID_TRANSITION', `Cannot ${action} an assignment that is ${row.status}`);
      }
      try {
        await db.$transaction(async (tx) => {
          const updated = await tx.workerAreaAssignment.updateMany({
            where: { id: row.id, status: row.status },
            data: {
              status: transition.to,
              statusChangedById: ctx.actorId,
              statusChangedAt: ctx.at,
              statusChangeReason: reason,
            },
          });
          if (updated.count !== 1)
            throw new AppError(409, 'CONCURRENT_CHANGE', 'Assignment changed meanwhile; reload');
          await recordAudit(tx, {
            actorUserId: ctx.actorId,
            action: `assignment.${action === 'reactivate' ? 'reactivated' : action === 'suspend' ? 'suspended' : 'revoked'}`,
            entityType: 'WorkerAreaAssignment',
            entityId: row.id,
            areaId: row.areaId,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            details: { previousStatus: row.status, status: transition.to, reason },
          });
        });
      } catch (error) {
        // Reactivating can collide with a newer overlapping assignment.
        if (isOverlapError(error)) {
          throw new AppError(
            409,
            'ASSIGNMENT_OVERLAP',
            'An overlapping assignment for this role and area exists',
          );
        }
        throw error;
      }
      return view(row.id);
    },
  };
}

export type AssignmentsService = ReturnType<typeof createAssignmentsService>;
