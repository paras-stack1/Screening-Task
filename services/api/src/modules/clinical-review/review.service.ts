import { randomUUID } from 'node:crypto';
import {
  OPEN_REVIEW_STATUSES,
  type ClinicalReviewDetail,
  type ClinicalReviewSummary,
  type ReviewDecisionRequest,
  type ReviewListQuery,
  type ReviewListResponse,
  type ReviewVersionRequest,
} from '@balswasthya/shared-contracts';
import { Prisma, type ClinicalReviewStatus, type PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { assertInScopeOrDeny, scopedWhere, type AccessContext } from '../access-control/accessScope';
import { permissionsOverArea } from '../access-control/authorization.service';
import { recordAudit } from '../audit/audit.service';
import { runInclude, toRun } from '../clinical-rules/results.service';
import { actorRoleCode, assertFacilityChoice, dueDateFrom, recordText } from '../referrals/referralCommon';

export interface ReviewServiceDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
}

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;
const CLAIMABLE: ClinicalReviewStatus[] = ['PENDING_REVIEW', 'ESCALATED', 'ADDITIONAL_INFORMATION_REQUIRED'];

/** Decision -> resulting review status (database CHECK review_decision_matches_status). */
const STATUS_FOR = {
  ACCEPT_RESULT: 'REVIEWED',
  RECOMMEND_REFERRAL: 'REVIEWED',
  REQUEST_ADDITIONAL_SCREENING: 'ADDITIONAL_INFORMATION_REQUIRED',
  ESCALATE_FOR_SPECIALIST_REVIEW: 'ESCALATED',
  REJECT_WITH_REASON: 'REJECTED',
} as const satisfies Record<ReviewDecisionRequest['decision'], ClinicalReviewStatus>;

const summaryInclude = {
  resultRun: {
    select: {
      id: true,
      sessionId: true,
      screeningVersion: true,
      supersededAt: true,
      overallOutcome: true,
      usesUnapprovedContent: true,
      session: {
        select: { childId: true, conductedById: true, child: { select: { fullName: true, areaId: true } } },
      },
    },
  },
  claimedBy: { select: { displayName: true } },
  decidedBy: { select: { displayName: true } },
} satisfies Prisma.ClinicalReviewInclude;
type SummaryRow = Prisma.ClinicalReviewGetPayload<{ include: typeof summaryInclude }>;

function toSummary(r: SummaryRow, userId: string): ClinicalReviewSummary {
  return {
    id: r.id,
    status: r.status,
    version: r.version,
    resultRunId: r.resultRunId,
    sessionId: r.resultRun.sessionId,
    childId: r.resultRun.session.childId,
    childName: r.resultRun.session.child.fullName,
    screeningVersion: r.resultRun.screeningVersion,
    isCurrent: r.resultRun.supersededAt === null,
    overallOutcome: r.resultRun.overallOutcome,
    usesUnapprovedContent: r.resultRun.usesUnapprovedContent,
    claimedByName: r.claimedBy?.displayName ?? null,
    claimedByMe: r.claimedById === userId,
    decision: r.decision,
    decidedByName: r.decidedBy?.displayName ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Clinical review (Step 7 stage 7C; decisions G-I, K; docs/step-7/clinical-review-workflow.md).
 *
 * Only screening.review holders (medical officers) whose scope covers the child's CURRENT area
 * see or act on reviews. One reviewer at a time: a review is CLAIMED (UNDER_REVIEW) before a
 * decision, and `expectedVersion` guards every change (409 on a stale write). The reviewer is
 * always the authenticated user - never an id from the request. Every action writes a review
 * event and an audit record in the same transaction.
 */
export function createReviewService({ db, pii }: ReviewServiceDependencies) {
  const text = recordText(pii);
  const at = (ctx: AccessContext) => ctx.at ?? new Date();
  const scope = (ctx: AccessContext) => scopedWhere.clinicalReview(ctx.userId, 'screening.review', at(ctx));
  const assertInScope = (ctx: AccessContext, id: string) =>
    assertInScopeOrDeny(db, ctx, 'clinicalReview', id, 'screening.review');

  async function loadDetail(ctx: AccessContext, id: string): Promise<ClinicalReviewDetail> {
    const r = await db.clinicalReview.findUniqueOrThrow({
      where: { id },
      include: {
        ...summaryInclude,
        events: {
          include: { actor: { select: { displayName: true } } },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        },
        referrals: { select: { id: true } },
        followUps: { select: { id: true } },
      },
    });
    const run = await db.screeningResultRun.findUniqueOrThrow({
      where: { id: r.resultRunId },
      include: runInclude,
    });
    const summary = toSummary(r, ctx.userId);
    const mine = r.claimedById === ctx.userId;
    return {
      ...summary,
      decidedByRoleCode: r.decidedByRoleCode,
      notes: text.open({ kind: 'review', id: r.id, field: 'notes' }, r.notes),
      conductedByReviewer: r.resultRun.session.conductedById === ctx.userId,
      result: toRun(run),
      history: r.events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        decision: e.decision,
        actorName: e.actor?.displayName ?? null,
        actorRoleCode: e.actorRoleCode,
        notes: text.open({ kind: 'reviewEvent', id: e.id, field: 'notes' }, e.notes),
        occurredAt: e.occurredAt.toISOString(),
      })),
      referralIds: r.referrals.map((x) => x.id),
      followUpIds: r.followUps.map((x) => x.id),
      canClaim: summary.isCurrent && CLAIMABLE.includes(r.status),
      canRelease: r.status === 'UNDER_REVIEW' && mine,
      canDecide: summary.isCurrent && r.status === 'UNDER_REVIEW' && mine,
    };
  }

  /** Shared guarded sequence: scope -> lock -> version -> action -> event + audit. */
  async function act(
    ctx: AccessContext,
    id: string,
    expectedVersion: number,
    run: (
      tx: Tx,
      r: SummaryRow,
    ) => Promise<{
      data: Prisma.ClinicalReviewUncheckedUpdateInput;
      toStatus: ClinicalReviewStatus;
      decision?: ReviewDecisionRequest['decision'];
      notes?: string;
      audit: { action: string; details: Prisma.InputJsonObject };
    }>,
  ): Promise<ClinicalReviewDetail> {
    await assertInScope(ctx, id);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ClinicalReview" WHERE id = ${id}::uuid FOR UPDATE`;
      const r = await tx.clinicalReview.findUniqueOrThrow({ where: { id }, include: summaryInclude });
      if (r.version !== expectedVersion) {
        throw AppError.conflict('VERSION_CONFLICT', 'This review was changed elsewhere. Reload it first.', {
          currentVersion: r.version,
        });
      }
      const outcome = await run(tx, r);
      const areaId = r.resultRun.session.child.areaId;
      const roleCode = await actorRoleCode(tx, ctx.userId, areaId, 'screening.review', at(ctx));
      const eventId = randomUUID();
      await tx.clinicalReviewEvent.create({
        data: {
          id: eventId,
          reviewId: id,
          fromStatus: r.status,
          toStatus: outcome.toStatus,
          decision: outcome.decision ?? null,
          actorId: ctx.userId,
          actorRoleCode: roleCode,
          notes: text.seal({ kind: 'reviewEvent', id: eventId, field: 'notes' }, outcome.notes),
        },
      });
      await tx.clinicalReview.update({
        where: { id },
        data: {
          ...outcome.data,
          status: outcome.toStatus,
          version: { increment: 1 },
          ...(outcome.decision && { decidedByRoleCode: roleCode }),
        },
      });
      await recordAudit(tx, {
        actorUserId: ctx.userId,
        action: outcome.audit.action,
        entityType: 'clinicalReview',
        entityId: id,
        areaId,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
        // Labels and ids only - never the notes.
        details: { from: r.status, to: outcome.toStatus, ...outcome.audit.details },
      });
    }, TX_OPTIONS);
    return loadDetail(ctx, id);
  }

  const superseded = () =>
    AppError.conflict(
      'RESULT_SUPERSEDED',
      'The screening was amended after this result. Review the result of the current version.',
    );

  return {
    async list(ctx: AccessContext, query: ReviewListQuery): Promise<ReviewListResponse> {
      const where: Prisma.ClinicalReviewWhereInput = {
        AND: [
          scope(ctx),
          query.status ? { status: query.status } : { status: { in: [...OPEN_REVIEW_STATUSES] } },
          query.includeSuperseded === 'true' ? {} : { resultRun: { supersededAt: null } },
        ],
      };
      const [rows, total] = await Promise.all([
        db.clinicalReview.findMany({
          where,
          include: summaryInclude,
          // Oldest first: a queue.
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.clinicalReview.count({ where }),
      ]);
      return {
        items: rows.map((r) => toSummary(r, ctx.userId)),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },

    async get(ctx: AccessContext, id: string): Promise<ClinicalReviewDetail> {
      await assertInScope(ctx, id);
      return loadDetail(ctx, id);
    },

    claim(ctx: AccessContext, id: string, body: ReviewVersionRequest) {
      return act(ctx, id, body.expectedVersion, (_tx, r) => {
        if (r.resultRun.supersededAt) throw superseded();
        if (r.status === 'UNDER_REVIEW') {
          throw AppError.conflict(
            'REVIEW_CLAIMED',
            r.claimedById === ctx.userId
              ? 'You are already reviewing this.'
              : 'Another reviewer is reviewing this.',
          );
        }
        if (!CLAIMABLE.includes(r.status)) {
          throw AppError.conflict('REVIEW_COMPLETED', 'This review is already completed.');
        }
        return Promise.resolve({
          data: {
            claimedById: ctx.userId,
            claimedAt: at(ctx),
            // Re-opening after escalation / more information clears the earlier decision fields
            // (kept in the review history).
            decision: null,
            decidedById: null,
            decidedAt: null,
            decidedByRoleCode: null,
            notes: null,
          },
          toStatus: 'UNDER_REVIEW',
          audit: { action: 'clinical_review.claimed', details: {} },
        });
      });
    },

    release(ctx: AccessContext, id: string, body: ReviewVersionRequest) {
      return act(ctx, id, body.expectedVersion, (_tx, r) => {
        if (r.status !== 'UNDER_REVIEW' || r.claimedById !== ctx.userId) {
          throw AppError.conflict(
            'NOT_YOUR_REVIEW',
            'Only the reviewer who claimed this review can release it.',
          );
        }
        return Promise.resolve({
          data: { claimedById: null, claimedAt: null },
          toStatus: 'PENDING_REVIEW',
          audit: { action: 'clinical_review.released', details: {} },
        });
      });
    },

    decide(ctx: AccessContext, id: string, body: ReviewDecisionRequest) {
      return act(ctx, id, body.expectedVersion, async (tx, r) => {
        if (r.status !== 'UNDER_REVIEW' || r.claimedById !== ctx.userId) {
          throw AppError.conflict('NOT_YOUR_REVIEW', 'Claim the review before recording a decision.');
        }
        if (r.resultRun.supersededAt) throw superseded();
        const child = r.resultRun.session.child;
        const now = at(ctx);
        const details: Record<string, string> = { decision: body.decision };
        let referralId: string | null = null;
        let followUpId: string | null = null;

        if (body.referral) {
          // The review IS the approval (decision K): the reviewer must also hold referral.approve.
          const perms = await permissionsOverArea(tx, ctx.userId, child.areaId, now);
          if (!perms.has('referral.approve')) {
            throw AppError.forbidden(
              'NOT_APPROVER',
              'Recommending a referral needs referral approval rights.',
            );
          }
          if (body.referral.facilityId) {
            await assertFacilityChoice(tx, child.areaId, body.referral.facilityId, {
              mayGoOutOfDistrict: true,
              outOfDistrictReason: body.referral.outOfDistrictReason,
            });
          }
          const result = await tx.screeningResult.findFirst({
            where: { resultRunId: r.resultRunId, category: body.referral.category },
            select: { id: true },
          });
          referralId = randomUUID();
          try {
            await tx.referral.create({
              data: {
                id: referralId,
                childId: r.resultRun.session.childId,
                sessionId: r.resultRun.sessionId,
                screeningResultId: result?.id ?? null,
                clinicalReviewId: id,
                origin: 'CLINICAL_REVIEW',
                status: 'APPROVED',
                facilityId: body.referral.facilityId ?? null,
                areaId: child.areaId,
                category: body.referral.category,
                urgency: body.referral.priority,
                reasonCode: 'CLINICAL_REVIEW',
                approvedById: ctx.userId,
                approvedAt: now,
                outOfDistrictReason: text.seal(
                  { kind: 'referral', id: referralId, field: 'outOfDistrictReason' },
                  body.referral.outOfDistrictReason,
                ),
                createdById: ctx.userId,
              },
            });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
              throw AppError.conflict(
                'REFERRAL_ALREADY_ACTIVE',
                'This child already has an active referral for this screening and category.',
              );
            }
            throw error;
          }
          await tx.referralStatusEvent.create({
            data: {
              referralId,
              toStatus: 'APPROVED',
              changedById: ctx.userId,
              actorRoleCode: await actorRoleCode(tx, ctx.userId, child.areaId, 'referral.approve', now),
              source: 'APP_USER_DIRECT',
              verificationStatus: 'VERIFIED',
              facilityId: body.referral.facilityId ?? null,
            },
          });
          await recordAudit(tx, {
            actorUserId: ctx.userId,
            action: 'referral.created',
            entityType: 'referral',
            entityId: referralId,
            areaId: child.areaId,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            details: {
              origin: 'CLINICAL_REVIEW',
              clinicalReviewId: id,
              category: body.referral.category,
              priority: body.referral.priority,
              facilityId: body.referral.facilityId ?? null,
              status: 'APPROVED',
            },
          });
          details.referralId = referralId;
        }

        if (body.followUp) {
          followUpId = randomUUID();
          try {
            await tx.followUp.create({
              data: {
                id: followUpId,
                childId: r.resultRun.session.childId,
                screeningSessionId: r.resultRun.sessionId,
                clinicalReviewId: id,
                reasonCode: 'ADDITIONAL_SCREENING',
                dueDate: dueDateFrom(body.followUp.dueDate, now),
                createdById: ctx.userId,
              },
            });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
              throw AppError.conflict(
                'FOLLOW_UP_ALREADY_ACTIVE',
                'This child already has an open follow-up for additional screening.',
              );
            }
            throw error;
          }
          await tx.followUpEvent.create({
            data: { followUpId, type: 'CREATED', toStatus: 'PENDING', actorId: ctx.userId },
          });
          details.followUpId = followUpId;
        }

        return {
          data: {
            decision: body.decision,
            decidedById: ctx.userId,
            decidedAt: now,
            notes: text.seal({ kind: 'review', id, field: 'notes' }, body.notes),
          },
          toStatus: STATUS_FOR[body.decision],
          decision: body.decision,
          notes: body.notes,
          audit: { action: 'clinical_review.decided', details },
        };
      });
    },
  };
}
