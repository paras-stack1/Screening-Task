import {
  formatCalendarDate,
  OPEN_REVIEW_STATUSES,
  REFERRAL_STATUSES,
  todayInIndia,
  FOUR_D_CATEGORIES,
  type AggregateReport,
  type AggregateReportQuery,
  type ReferralDashboard,
  type ResultDashboard,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import {
  areaScopeWhere,
  childScopeWhere,
  scopedWhere,
  type AccessContext,
} from '../access-control/accessScope';
import { hasPermissionAnywhere } from '../access-control/authorization.service';

/**
 * Dashboards and aggregate reports (Step 7 decision T; metric definitions in
 * docs/step-7/api-documentation.md). Every number is a database count over the caller's scope -
 * nothing is estimated or invented. Issued, acknowledged, visited and closed are separate counts.
 */

/** Small-cell suppression (ASSUMPTION, pending the programme's privacy policy). */
export const SUPPRESSION_THRESHOLD = 5;
const suppress = (value: number) =>
  value > 0 && value < SUPPRESSION_THRESHOLD
    ? { value: null, suppressed: true }
    : { value, suppressed: false };

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
/** India calendar date -> the UTC instant of its start (00:00 IST). */
const istStart = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS);
const todayDate = (now: Date) => new Date(`${formatCalendarDate(todayInIndia(now))}T00:00:00Z`);
const OPEN_FOLLOW_UP = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] as const;

export function createReportsService({ db }: { db: PrismaClient }) {
  const at = (ctx: AccessContext) => ctx.at ?? new Date();

  return {
    /** Individual-record dashboard: only records the caller may already read (child.read). */
    async referralDashboard(ctx: AccessContext): Promise<ReferralDashboard> {
      const now = at(ctx);
      const ref = scopedWhere.referral(ctx.userId, 'child.read', now);
      const fu = scopedWhere.followUp(ctx.userId, 'child.read', now);
      const count = (where: Prisma.ReferralWhereInput) => db.referral.count({ where: { AND: [ref, where] } });
      const [
        grouped,
        total,
        issued,
        acknowledged,
        visited,
        reassess,
        open,
        overdue,
        missed,
        mine,
        isReviewer,
      ] = await Promise.all([
        db.referral.groupBy({ by: ['status'], where: ref, _count: { _all: true } }),
        count({}),
        count({ issuedAt: { not: null } }),
        count({ statusEvents: { some: { toStatus: 'ACKNOWLEDGED', correctedBy: null } } }),
        count({ statusEvents: { some: { toStatus: 'VISITED', correctedBy: null } } }),
        count({ amendmentImpacts: { some: { reassessmentStatus: 'PENDING' } } }),
        db.followUp.count({ where: { AND: [fu, { status: { in: [...OPEN_FOLLOW_UP] } }] } }),
        db.followUp.count({
          where: { AND: [fu, { status: { in: [...OPEN_FOLLOW_UP] }, dueDate: { lt: todayDate(now) } }] },
        }),
        db.followUp.count({ where: { AND: [fu, { status: 'MISSED' }] } }),
        db.followUp.count({
          where: { AND: [fu, { status: { in: [...OPEN_FOLLOW_UP] }, assignedToId: ctx.userId }] },
        }),
        hasPermissionAnywhere(db, ctx.userId, 'screening.review', now),
      ]);
      const byStatus = Object.fromEntries(
        REFERRAL_STATUSES.map((s) => [s, 0]),
      ) as ReferralDashboard['referrals']['byStatus'];
      for (const g of grouped) byStatus[g.status] = g._count._all;
      const reviewsOpen = isReviewer
        ? await db.clinicalReview.count({
            where: {
              ...scopedWhere.clinicalReview(ctx.userId, 'screening.review', now),
              status: { in: [...OPEN_REVIEW_STATUSES] },
              resultRun: { supersededAt: null },
            },
          })
        : null;
      return {
        referrals: {
          total,
          byStatus,
          pendingApproval: byStatus.PENDING_APPROVAL,
          issued,
          acknowledged,
          visitRecorded: visited,
          closed: byStatus.CLOSED,
          awaitingReassessment: reassess,
        },
        followUps: { open, overdue, missed, assignedToMe: mine },
        reviewsOpen,
      };
    },

    async resultDashboard(ctx: AccessContext): Promise<ResultDashboard> {
      const now = at(ctx);
      const runs: Prisma.ScreeningResultRunWhereInput = {
        ...scopedWhere.screeningResultRun(ctx.userId, 'child.read', now),
        supersededAt: null,
      };
      const outcome = (o: Prisma.ScreeningResultRunWhereInput) =>
        db.screeningResultRun.count({ where: { AND: [runs, o] } });
      const [completed, awaitingReview, further, urgent, incomplete, notInterpreted, unapproved] =
        await Promise.all([
          db.screeningSession.count({
            where: { ...scopedWhere.screeningSession(ctx.userId, 'child.read', now), status: 'COMPLETED' },
          }),
          outcome({ review: { status: { in: ['PENDING_REVIEW', 'UNDER_REVIEW'] } } }),
          outcome({ overallOutcome: 'FURTHER_EVALUATION_RECOMMENDED' }),
          outcome({ overallOutcome: 'URGENT_EVALUATION_RECOMMENDED' }),
          outcome({ overallOutcome: { in: ['INCOMPLETE', 'UNABLE_TO_DETERMINE'] } }),
          outcome({ overallOutcome: 'NOT_INTERPRETED' }),
          outcome({ usesUnapprovedContent: true }),
        ]);
      return {
        completedScreenings: completed,
        awaitingReview,
        furtherEvaluation: further,
        urgentEvaluation: urgent,
        incompleteOrUndetermined: incomplete,
        notInterpreted,
        includesUnapprovedContent: unapproved > 0,
      };
    },

    /**
     * Aggregate-only report for report.aggregate holders (district / state administrators,
     * supervisors) - no child is ever listed. Counts 1-4 are suppressed. The area must be inside
     * the caller's report.aggregate scope (else 404, the same as "does not exist").
     */
    async aggregate(ctx: AccessContext, query: AggregateReportQuery): Promise<AggregateReport> {
      const now = at(ctx);
      if (query.from > query.to) throw AppError.badRequest('"from" must not be after "to"');
      const from = istStart(query.from);
      const to = new Date(istStart(query.to).getTime() + 86_400_000);
      if (to.getTime() - from.getTime() > 367 * 86_400_000)
        throw AppError.badRequest('At most one year per report');
      const area = await db.area.findFirst({
        where: { id: query.areaId, ...areaScopeWhere(ctx.userId, 'report.aggregate', now) },
        select: {
          id: true,
          nameEn: true,
          subAreas: { select: { id: true, nameEn: true }, orderBy: { nameEn: 'asc' } },
        },
      });
      if (!area) throw AppError.notFound('Area not found');
      const inArea = (areaId: string): Prisma.ChildWhereInput => ({
        AND: [
          childScopeWhere(ctx.userId, 'report.aggregate', now),
          { area: { ancestorLinks: { some: { ancestorId: areaId } } } },
        ],
      });
      const range = { gte: from, lt: to };
      const referrals = (areaId: string, where: Prisma.ReferralWhereInput) =>
        db.referral.count({ where: { AND: [{ child: inArea(areaId) }, where] } });
      const event = (status: 'ACKNOWLEDGED' | 'VISITED') => ({
        statusEvents: { some: { toStatus: status, changedAt: range, correctedBy: null } },
      });

      const [screenings, created, issued, acknowledged, visits, closed, overdue] = await Promise.all([
        db.screeningSession.count({
          where: { child: inArea(area.id), status: 'COMPLETED', completedAt: range },
        }),
        referrals(area.id, { createdAt: range }),
        referrals(area.id, { issuedAt: range }),
        referrals(area.id, event('ACKNOWLEDGED')),
        referrals(area.id, event('VISITED')),
        referrals(area.id, { closedAt: range }),
        db.followUp.count({
          where: {
            child: inArea(area.id),
            status: { in: [...OPEN_FOLLOW_UP] },
            dueDate: { lt: todayDate(now) },
          },
        }),
      ]);
      const byCategory = await Promise.all(
        FOUR_D_CATEGORIES.map(async (category) => ({
          category,
          referralsCreated: suppress(await referrals(area.id, { createdAt: range, category })),
        })),
      );
      const bySubArea = await Promise.all(
        area.subAreas.map(async (sub) => ({
          areaId: sub.id,
          areaName: sub.nameEn,
          referralsCreated: suppress(await referrals(sub.id, { createdAt: range })),
          referralsIssued: suppress(await referrals(sub.id, { issuedAt: range })),
        })),
      );
      return {
        areaId: area.id,
        areaName: area.nameEn,
        from: query.from,
        to: query.to,
        suppressionThreshold: SUPPRESSION_THRESHOLD,
        screeningsCompleted: suppress(screenings),
        referralsCreated: suppress(created),
        referralsIssued: suppress(issued),
        referralsAcknowledged: suppress(acknowledged),
        visitsRecorded: suppress(visits),
        referralsClosed: suppress(closed),
        followUpsOverdue: suppress(overdue),
        byCategory,
        bySubArea,
      };
    },
  };
}
