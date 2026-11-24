import { randomUUID } from 'node:crypto';
import {
  formatCalendarDate,
  todayInIndia,
  type AssignFollowUpRequest,
  type CompleteFollowUpRequest,
  type CreateFollowUpRequest,
  type FollowUpDetail,
  type FollowUpListQuery,
  type FollowUpListResponse,
  type FollowUpReasonRequest,
  type FollowUpSummary,
  type FollowUpVersionRequest,
  type RescheduleFollowUpRequest,
} from '@balswasthya/shared-contracts';
import { Prisma, type FollowUpEventType, type FollowUpStatus, type PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { runIdempotent } from '../../utils/idempotency';
import type { PiiCrypto } from '../../utils/piiCrypto';
import {
  assertInScopeOrDeny,
  findChildOrDeny,
  scopedWhere,
  type AccessContext,
} from '../access-control/accessScope';
import { permissionsOverArea } from '../access-control/authorization.service';
import type { PermissionCode } from '../access-control/permissions';
import { recordAudit } from '../audit/audit.service';
import { notifyAfterCommit } from '../notifications/notifications.service';
import { dueDateFrom, recordText } from '../referrals/referralCommon';

export interface FollowUpsServiceDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
}

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;
const OPEN: FollowUpStatus[] = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'];

/** India "today" as a DATE value (UTC midnight), for overdue checks. */
function todayDate(now: Date): Date {
  return new Date(`${formatCalendarDate(todayInIndia(now))}T00:00:00Z`);
}

const detailInclude = {
  child: { select: { fullName: true, areaId: true } },
  assignedTo: { select: { displayName: true } },
  completedBy: { select: { displayName: true } },
  createdBy: { select: { displayName: true } },
  events: {
    include: { actor: { select: { displayName: true } }, assignedTo: { select: { displayName: true } } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.FollowUpInclude;
type DetailRow = Prisma.FollowUpGetPayload<{ include: typeof detailInclude }>;
const summaryInclude = {
  child: { select: { fullName: true } },
  assignedTo: { select: { displayName: true } },
} satisfies Prisma.FollowUpInclude;
type SummaryRow = Prisma.FollowUpGetPayload<{ include: typeof summaryInclude }>;

export function followUpActions(
  f: { status: FollowUpStatus; assignedToId: string | null },
  perms: Set<PermissionCode>,
  userId: string,
) {
  const manager = perms.has('referral.update');
  const assignee = f.assignedToId === userId && perms.has('follow_up.update');
  const working = f.status === 'ASSIGNED' || f.status === 'IN_PROGRESS';
  return {
    assign: manager && OPEN.includes(f.status),
    start: assignee && f.status === 'ASSIGNED',
    complete: (assignee || manager) && working,
    reschedule: (assignee || manager) && (OPEN.includes(f.status) || f.status === 'MISSED'),
    miss: (assignee || manager) && working,
    cancel: manager && (OPEN.includes(f.status) || f.status === 'MISSED'),
  };
}

/**
 * Follow-up tasks (Step 7 stage 7D; decisions Q, R; docs/step-7/follow-up-management.md).
 * Field workers work on tasks assigned to them; supervisors and medical officers
 * (referral.update) assign, reassign and cancel. A task is assigned only to a user who holds
 * follow_up.update over the child's current area. Completing a follow-up NEVER changes a referral.
 * Every change: scope (404 + audit) -> lock -> version (409) -> permission (403 + audit) ->
 * state (409) -> event + update + audit in one transaction; notifications after commit.
 */
export function createFollowUpsService({ db, pii }: FollowUpsServiceDependencies) {
  const text = recordText(pii);
  const at = (ctx: AccessContext) => ctx.at ?? new Date();

  function toSummary(f: SummaryRow | DetailRow, userId: string, now: Date): FollowUpSummary {
    return {
      id: f.id,
      childId: f.childId,
      childName: f.child.fullName,
      referralId: f.referralId,
      sessionId: f.screeningSessionId,
      clinicalReviewId: f.clinicalReviewId,
      reasonCode: f.reasonCode,
      dueDate: f.dueDate.toISOString().slice(0, 10),
      status: f.status,
      overdue: OPEN.includes(f.status) && f.dueDate.getTime() < todayDate(now).getTime(),
      assignedToId: f.assignedToId,
      assignedToName: f.assignedTo?.displayName ?? null,
      assignedToMe: f.assignedToId === userId,
      version: f.version,
      updatedAt: f.updatedAt.toISOString(),
    };
  }

  async function loadDetail(ctx: AccessContext, id: string): Promise<FollowUpDetail> {
    const f = await db.followUp.findUniqueOrThrow({ where: { id }, include: detailInclude });
    const perms = await permissionsOverArea(db, ctx.userId, f.child.areaId, at(ctx));
    return {
      ...toSummary(f, ctx.userId, at(ctx)),
      reasonNote: text.open({ kind: 'followUp', id, field: 'reasonNote' }, f.reasonNote),
      nextAction: text.open({ kind: 'followUp', id, field: 'nextAction' }, f.nextAction),
      outcomeNote: text.open({ kind: 'followUp', id, field: 'outcomeNote' }, f.outcomeNote),
      completedAt: f.completedAt?.toISOString() ?? null,
      completedByName: f.completedBy?.displayName ?? null,
      createdByName: f.createdBy.displayName,
      history: f.events.map((e) => ({
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorName: e.actor.displayName,
        assignedToName: e.assignedTo?.displayName ?? null,
        oldDueDate: e.oldDueDate?.toISOString().slice(0, 10) ?? null,
        newDueDate: e.newDueDate?.toISOString().slice(0, 10) ?? null,
        reason: text.open({ kind: 'followUpEvent', id: e.id, field: 'reason' }, e.reason),
        occurredAt: e.occurredAt.toISOString(),
      })),
      actions: followUpActions(f, perms, ctx.userId),
    };
  }

  async function assertAssignable(tx: Tx | PrismaClient, userId: string, areaId: string, now: Date) {
    const perms = await permissionsOverArea(tx, userId, areaId, now);
    if (!perms.has('follow_up.update')) {
      throw AppError.unprocessable(
        'ASSIGNEE_NOT_ELIGIBLE',
        "This person cannot work on follow-ups in the child's area.",
      );
    }
  }

  class Denied extends Error {}

  async function change(
    ctx: AccessContext,
    id: string,
    expectedVersion: number,
    action: keyof ReturnType<typeof followUpActions>,
    decide: (
      tx: Tx,
      f: Prisma.FollowUpGetPayload<{ include: { child: { select: { areaId: true } } } }>,
    ) => Promise<{
      data: Prisma.FollowUpUncheckedUpdateInput;
      event: {
        type: FollowUpEventType;
        toStatus: FollowUpStatus;
        reason?: string;
        assignedToId?: string;
        oldDueDate?: Date;
        newDueDate?: Date;
      };
      notifyAssignee?: string;
    }>,
  ): Promise<FollowUpDetail> {
    await assertInScopeOrDeny(db, ctx, 'followUp', id, 'child.read');
    let notifyUser: string | undefined;
    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "FollowUp" WHERE id = ${id}::uuid FOR UPDATE`;
        const f = await tx.followUp.findUniqueOrThrow({
          where: { id },
          include: { child: { select: { areaId: true } } },
        });
        if (f.version !== expectedVersion) {
          throw AppError.conflict(
            'VERSION_CONFLICT',
            'This follow-up was changed elsewhere. Reload it first.',
            {
              currentVersion: f.version,
            },
          );
        }
        if (f.status === 'COMPLETED' || f.status === 'CANCELLED') {
          throw AppError.conflict('FOLLOW_UP_FINAL', `This follow-up is ${f.status.toLowerCase()}.`);
        }
        const perms = await permissionsOverArea(tx, ctx.userId, f.child.areaId, at(ctx));
        if (!followUpActions(f, perms, ctx.userId)[action]) {
          // Allowed in principle, but not in this state -> 409; not allowed for this user -> 403.
          const anyState = followUpActions(
            { status: 'ASSIGNED', assignedToId: f.assignedToId },
            perms,
            ctx.userId,
          )[action];
          if (anyState)
            throw AppError.conflict(
              'INVALID_FOLLOW_UP_STATE',
              `Not possible while the follow-up is ${f.status}.`,
            );
          throw new Denied(action);
        }
        const c = await decide(tx, f);
        const eventId = randomUUID();
        await tx.followUpEvent.create({
          data: {
            id: eventId,
            followUpId: id,
            type: c.event.type,
            fromStatus: f.status,
            toStatus: c.event.toStatus,
            actorId: ctx.userId,
            assignedToId: c.event.assignedToId ?? null,
            oldDueDate: c.event.oldDueDate ?? null,
            newDueDate: c.event.newDueDate ?? null,
            reason: text.seal({ kind: 'followUpEvent', id: eventId, field: 'reason' }, c.event.reason),
          },
        });
        await tx.followUp.update({
          where: { id },
          data: { ...c.data, status: c.event.toStatus, version: { increment: 1 } },
        });
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: `follow_up.${c.event.type.toLowerCase()}`,
          entityType: 'followUp',
          entityId: id,
          areaId: f.child.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: { from: f.status, to: c.event.toStatus, assignedToId: c.event.assignedToId ?? null },
        });
        notifyUser = c.notifyAssignee;
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof Denied) {
        const f = await db.followUp.findUniqueOrThrow({
          where: { id },
          include: { child: { select: { areaId: true } } },
        });
        await recordAudit(db, {
          actorUserId: ctx.userId,
          action: 'follow_up.action_denied',
          entityType: 'followUp',
          entityId: id,
          areaId: f.child.areaId,
          outcome: 'DENIED',
          requestId: ctx.requestId,
          details: { action },
        });
        throw AppError.forbidden(
          'FOLLOW_UP_ACTION_NOT_ALLOWED',
          'You are not allowed to do this with this follow-up.',
        );
      }
      throw error;
    }
    if (notifyUser && notifyUser !== ctx.userId) {
      const userId = notifyUser;
      const version = expectedVersion + 1;
      await notifyAfterCommit(db, () =>
        Promise.resolve([
          {
            userId,
            type: 'FOLLOW_UP_ASSIGNED',
            entityType: 'followUp',
            entityId: id,
            dedupeKey: `FOLLOW_UP_ASSIGNED:${id}:${version}`,
          },
        ]),
      );
    }
    return loadDetail(ctx, id);
  }

  return {
    loadDetail,

    async get(ctx: AccessContext, id: string) {
      await assertInScopeOrDeny(db, ctx, 'followUp', id, 'child.read');
      return loadDetail(ctx, id);
    },

    async list(ctx: AccessContext, query: FollowUpListQuery): Promise<FollowUpListResponse> {
      const now = at(ctx);
      const today = todayDate(now);
      const where: Prisma.FollowUpWhereInput = {
        AND: [
          scopedWhere.followUp(ctx.userId, 'child.read', now),
          query.assigned === 'mine'
            ? { assignedToId: ctx.userId }
            : query.assigned === 'unassigned'
              ? { assignedToId: null }
              : {},
          query.status ? { status: query.status } : {},
          query.overdue === 'true' ? { status: { in: OPEN }, dueDate: { lt: today } } : {},
          query.childId ? { childId: query.childId } : {},
          query.referralId ? { referralId: query.referralId } : {},
        ],
      };
      const [rows, total] = await Promise.all([
        db.followUp.findMany({
          where,
          include: summaryInclude,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.followUp.count({ where }),
      ]);
      return {
        items: rows.map((r) => toSummary(r, ctx.userId, now)),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },

    async create(
      ctx: AccessContext,
      body: CreateFollowUpRequest,
    ): Promise<{ result: FollowUpDetail; replayed: boolean }> {
      const now = at(ctx);
      const child = await findChildOrDeny(db, ctx, body.childId, 'child.read');
      const perms = await permissionsOverArea(db, ctx.userId, child.areaId, now);
      const manager = perms.has('referral.update');
      if (!manager && !perms.has('referral.create')) {
        throw AppError.forbidden(
          'FOLLOW_UP_ACTION_NOT_ALLOWED',
          'You cannot create follow-ups for this child.',
        );
      }
      // A field worker's own task is theirs; only supervisors / medical officers assign others.
      let assignee: string | null = body.assignToUserId ?? null;
      if (assignee && assignee !== ctx.userId && !manager) {
        throw AppError.forbidden(
          'FOLLOW_UP_ACTION_NOT_ALLOWED',
          'Only a supervisor or medical officer assigns follow-ups to others.',
        );
      }
      if (!assignee && !manager && perms.has('follow_up.update')) assignee = ctx.userId;
      if (assignee) await assertAssignable(db, assignee, child.areaId, now);
      if (body.referralId) {
        const r = await db.referral.findUnique({ where: { id: body.referralId }, select: { childId: true } });
        if (r?.childId !== child.id)
          throw AppError.unprocessable('REFERRAL_CHILD_MISMATCH', 'This referral is not for this child.');
      }
      if (body.sessionId) {
        const s = await db.screeningSession.findUnique({
          where: { id: body.sessionId },
          select: { childId: true },
        });
        if (s?.childId !== child.id)
          throw AppError.unprocessable('SCREENING_CHILD_MISMATCH', 'This screening is not for this child.');
      }
      const dueDate = dueDateFrom(body.dueDate, now);
      let replayed = false;
      let entityId: string;
      try {
        const outcome = await runIdempotent(
          db,
          {
            userId: ctx.userId,
            clientOperationId: body.clientOperationId,
            operationType: 'follow_up.create',
            entityType: 'followUp',
            request: body,
          },
          async (tx) => {
            const id = randomUUID();
            const status: FollowUpStatus = assignee ? 'ASSIGNED' : 'PENDING';
            await tx.followUp.create({
              data: {
                id,
                childId: child.id,
                referralId: body.referralId ?? null,
                screeningSessionId: body.sessionId ?? null,
                reasonCode: body.reasonCode,
                reasonNote: text.seal({ kind: 'followUp', id, field: 'reasonNote' }, body.reasonNote),
                nextAction: text.seal({ kind: 'followUp', id, field: 'nextAction' }, body.nextAction),
                dueDate,
                status,
                assignedToId: assignee,
                assignedById: assignee ? ctx.userId : null,
                clientOperationId: body.clientOperationId,
                createdById: ctx.userId,
              },
            });
            await tx.followUpEvent.create({
              data: {
                followUpId: id,
                type: 'CREATED',
                toStatus: status,
                actorId: ctx.userId,
                assignedToId: assignee,
                newDueDate: dueDate,
              },
            });
            await recordAudit(tx, {
              actorUserId: ctx.userId,
              action: 'follow_up.created',
              entityType: 'followUp',
              entityId: id,
              areaId: child.areaId,
              outcome: 'SUCCESS',
              requestId: ctx.requestId,
              details: {
                childId: child.id,
                referralId: body.referralId ?? null,
                reasonCode: body.reasonCode,
                assignedToId: assignee,
              },
            });
            return id;
          },
        );
        replayed = outcome.replayed;
        entityId = outcome.entityId;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          error.meta?.modelName === 'FollowUp'
        ) {
          throw AppError.conflict(
            'FOLLOW_UP_ALREADY_ACTIVE',
            'This child already has an open follow-up for this reason and referral.',
          );
        }
        throw error;
      }
      if (!replayed && assignee && assignee !== ctx.userId) {
        const userId = assignee;
        await notifyAfterCommit(db, () =>
          Promise.resolve([
            {
              userId,
              type: 'FOLLOW_UP_ASSIGNED',
              entityType: 'followUp',
              entityId,
              dedupeKey: `FOLLOW_UP_ASSIGNED:${entityId}:1`,
            },
          ]),
        );
      }
      return { result: await loadDetail(ctx, entityId), replayed };
    },

    assign(ctx: AccessContext, id: string, body: AssignFollowUpRequest) {
      return change(ctx, id, body.expectedVersion, 'assign', async (tx, f) => {
        await assertAssignable(tx, body.assignToUserId, f.child.areaId, at(ctx));
        const reassign = f.assignedToId !== null;
        if (reassign && !body.reason) {
          throw AppError.unprocessable('REASON_REQUIRED', 'Give the reason for reassigning this follow-up.');
        }
        if (f.assignedToId === body.assignToUserId) {
          throw AppError.conflict('ALREADY_ASSIGNED', 'This follow-up is already assigned to this person.');
        }
        return {
          data: { assignedToId: body.assignToUserId, assignedById: ctx.userId },
          event: {
            type: reassign ? 'REASSIGNED' : 'ASSIGNED',
            toStatus: 'ASSIGNED',
            reason: body.reason,
            assignedToId: body.assignToUserId,
          },
          notifyAssignee: body.assignToUserId,
        };
      });
    },

    start(ctx: AccessContext, id: string, body: FollowUpVersionRequest) {
      return change(ctx, id, body.expectedVersion, 'start', () =>
        Promise.resolve({ data: {}, event: { type: 'STARTED', toStatus: 'IN_PROGRESS' } }),
      );
    },

    /** Decision R: completing a follow-up never changes the referral. */
    complete(ctx: AccessContext, id: string, body: CompleteFollowUpRequest) {
      return change(ctx, id, body.expectedVersion, 'complete', () =>
        Promise.resolve({
          data: {
            completedAt: at(ctx),
            completedById: ctx.userId,
            outcomeNote: text.seal({ kind: 'followUp', id, field: 'outcomeNote' }, body.outcomeNote),
            ...(body.nextAction && {
              nextAction: text.seal({ kind: 'followUp', id, field: 'nextAction' }, body.nextAction),
            }),
          },
          event: { type: 'COMPLETED', toStatus: 'COMPLETED' },
        }),
      );
    },

    reschedule(ctx: AccessContext, id: string, body: RescheduleFollowUpRequest) {
      return change(ctx, id, body.expectedVersion, 'reschedule', (_tx, f) => {
        const dueDate = dueDateFrom(body.dueDate, at(ctx));
        // A missed task goes back to its assignee; otherwise the status stays as it was.
        const toStatus: FollowUpStatus = f.status === 'MISSED' ? 'ASSIGNED' : f.status;
        return Promise.resolve({
          data: { dueDate },
          event: {
            type: 'RESCHEDULED',
            toStatus,
            reason: body.reason,
            oldDueDate: f.dueDate,
            newDueDate: dueDate,
          },
        });
      });
    },

    miss(ctx: AccessContext, id: string, body: FollowUpReasonRequest) {
      return change(ctx, id, body.expectedVersion, 'miss', () =>
        Promise.resolve({ data: {}, event: { type: 'MISSED', toStatus: 'MISSED', reason: body.reason } }),
      );
    },

    cancel(ctx: AccessContext, id: string, body: FollowUpReasonRequest) {
      return change(ctx, id, body.expectedVersion, 'cancel', () =>
        Promise.resolve({
          data: {},
          event: { type: 'CANCELLED', toStatus: 'CANCELLED', reason: body.reason },
        }),
      );
    },
  };
}
