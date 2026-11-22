import {
  FOUR_D_CATEGORIES,
  formatCalendarDate,
  type ScreeningBlocker,
  type ScreeningEligibilityResponse,
  type ScreeningProtocolDetail,
  type ScreeningProtocolListQuery,
  type ScreeningProtocolListResponse,
  type ScreeningProtocolSummary,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient, ScreeningProtocol } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { findChildOrDeny, type AccessContext } from '../access-control/accessScope';
import { evaluateConsents, type ConsentPolicySettings } from '../consent/consentPolicy';
import { protocolRowToDefinition, type ProtocolWithQuestions } from './protocolContent';
import { isUsable, selectProtocol, type ScreeningPolicySettings } from './protocolSelection';
import { screeningAge } from './screeningAge';

export interface ProtocolsServiceDependencies {
  db: PrismaClient;
  consentPolicy: ConsentPolicySettings;
  screeningPolicy: ScreeningPolicySettings;
}

const summaryInclude = { _count: { select: { questions: true } } } satisfies Prisma.ScreeningProtocolInclude;
type SummaryRow = Prisma.ScreeningProtocolGetPayload<{ include: typeof summaryInclude }>;

function toSummary(row: ScreeningProtocol, questionCount: number): ScreeningProtocolSummary {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    category: row.category,
    name: { hi: row.nameHi, en: row.nameEn },
    description:
      row.descriptionEn !== null && row.descriptionHi !== null
        ? { hi: row.descriptionHi, en: row.descriptionEn }
        : null,
    ageMinDays: row.ageMinDays,
    ageMaxDays: row.ageMaxDays,
    sourceReference: row.sourceReference,
    status: row.status,
    isDemonstration: row.isDemonstration,
    isClinicallyApproved: row.status === 'ACTIVE' && !row.isDemonstration,
    approvalReference: row.approvalReference,
    clinicalApprovedAt: row.clinicalApprovedAt?.toISOString() ?? null,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    questionCount,
  };
}

/** Builds the detail from VALIDATED stored content (invalid stored content is never served). */
function toDetail(row: ProtocolWithQuestions): ScreeningProtocolDetail {
  const def = protocolRowToDefinition(row);
  const ids = new Map(row.questions.map((q) => [q.code, q.id]));
  const questions = [...def.questions]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map((q) => ({
      id: ids.get(q.code)!,
      code: q.code,
      sectionCode: q.sectionCode,
      sortOrder: q.sortOrder,
      prompt: q.prompt,
      help: q.help ?? null,
      answerType: q.answerType,
      options: q.options ?? null,
      validation: q.validation ?? null,
      isRequired: q.isRequired,
    }));
  return { ...toSummary(row, row.questions.length), contentSha256: row.contentSha256, questions };
}

/**
 * Screening protocol content (read-only, Step 6 decision S) and per-child eligibility (decision O).
 * Protocol content is not personal data, but unapproved drafts are hidden wherever draft content
 * is not allowed (production), so they can never be mistaken for operational content.
 */
export function createProtocolsService({ db, consentPolicy, screeningPolicy }: ProtocolsServiceDependencies) {
  /** Statuses a caller may READ: drafts and in-review content only where drafts are allowed. */
  const visibleStatuses = screeningPolicy.allowDraftProtocols
    ? undefined
    : { in: ['APPROVED', 'ACTIVE', 'RETIRED'] as Array<'APPROVED' | 'ACTIVE' | 'RETIRED'> };

  async function findVisible(id: string): Promise<ProtocolWithQuestions> {
    const row = await db.screeningProtocol.findFirst({
      where: { id, ...(visibleStatuses ? { status: visibleStatuses } : {}) },
      include: { questions: true },
    });
    if (!row) throw AppError.notFound('Screening protocol not found');
    return row;
  }

  return {
    /** Protocols usable for screening today (optionally one category). */
    async listUsable(query: ScreeningProtocolListQuery, at: Date): Promise<ScreeningProtocolListResponse> {
      const rows = await db.screeningProtocol.findMany({
        where: {
          ...(query.category ? { category: query.category } : {}),
          status: { in: screeningPolicy.allowDraftProtocols ? ['ACTIVE', 'DRAFT'] : ['ACTIVE'] },
        },
        include: summaryInclude,
        orderBy: [{ category: 'asc' }, { ageMinDays: 'asc' }, { code: 'asc' }, { version: 'desc' }],
      });
      return {
        items: rows
          .filter((r) => isUsable(r, screeningPolicy, at))
          .map((r) => toSummary(r, r._count.questions)),
      };
    },

    async get(id: string): Promise<{ protocol: ScreeningProtocolDetail }> {
      return { protocol: toDetail(await findVisible(id)) };
    },

    /** Every visible version of the same protocol code, newest first (for history screens). */
    async versions(id: string): Promise<ScreeningProtocolListResponse> {
      const { code } = await findVisible(id);
      const rows = await db.screeningProtocol.findMany({
        where: { code, ...(visibleStatuses ? { status: visibleStatuses } : {}) },
        include: summaryInclude,
        orderBy: { version: 'desc' },
      });
      return { items: rows.map((r) => toSummary(r, r._count.questions)) };
    },

    /**
     * Can this worker start a screening for this child today, and with which protocols? Child
     * access is checked with screening.conduct (out of scope = 404 + audit). Everything shown is
     * computed here; the app never decides eligibility.
     */
    async eligibility(ctx: AccessContext, childId: string): Promise<ScreeningEligibilityResponse> {
      const at = ctx.at ?? new Date();
      const child = await findChildOrDeny(db, ctx, childId, 'screening.conduct');
      const age = screeningAge(child.dateOfBirth, child.dobIsEstimated, at);

      const [[consent], openSession, candidates] = await Promise.all([
        evaluateConsents(db, childId, ['SCREENING'], consentPolicy),
        db.screeningSession.findFirst({
          where: { childId, status: { in: ['DRAFT', 'IN_PROGRESS'] } },
          select: { id: true },
        }),
        age.ageInDays === null
          ? Promise.resolve([] as SummaryRow[])
          : db.screeningProtocol.findMany({
              where: {
                status: { in: screeningPolicy.allowDraftProtocols ? ['ACTIVE', 'DRAFT'] : ['ACTIVE'] },
                ageMinDays: { lte: age.ageInDays },
                ageMaxDays: { gte: age.ageInDays },
              },
              include: summaryInclude,
            }),
      ]);

      const categories = FOUR_D_CATEGORIES.map((category) => {
        const choice = selectProtocol(candidates, category, age.ageInDays, screeningPolicy, at);
        return {
          category,
          available: choice.protocol !== null,
          reason: choice.reason,
          protocol: choice.protocol ? toSummary(choice.protocol, choice.protocol._count.questions) : null,
        };
      });

      const blockers: ScreeningBlocker[] = [];
      if (!consent!.permitted) blockers.push('CONSENT_NOT_PERMITTED');
      if (age.ageInDays === null) blockers.push('AGE_NOT_DETERMINABLE');
      else if (!categories.some((c) => c.available)) blockers.push('NO_CATEGORY_AVAILABLE');
      if (openSession) blockers.push('OPEN_SESSION_EXISTS');

      return {
        childId,
        screeningDate: formatCalendarDate(age.screeningDate),
        dateOfBirth: formatCalendarDate(age.dateOfBirth),
        dobIsEstimated: age.dobIsEstimated,
        ageInDays: age.ageInDays,
        age: age.age,
        consent: consent!,
        openSessionId: openSession?.id ?? null,
        categories,
        canStart: blockers.length === 0,
        blockers,
        usesUnapprovedContent: categories.some(
          (c) => c.protocol !== null && !c.protocol.isClinicallyApproved,
        ),
      };
    },
  };
}
