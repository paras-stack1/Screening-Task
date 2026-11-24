import {
  storedRuleDefinitionSchema,
  type CategoryResult,
  type ClinicalRuleSetDetail,
  type ClinicalRuleSetListQuery,
  type ClinicalRuleSetSummary,
  type GenerateResultResponse,
  type ResultLimitation,
  type ResultListQuery,
  type ResultListResponse,
  type ResultRun,
  type ResultRunSummary,
  type RuleEvaluation,
  type SessionResultsResponse,
} from '@balswasthya/shared-contracts';
import { conditionInputs } from '@balswasthya/shared-contracts';
import type { ClinicalRuleSet, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import type { PiiCrypto } from '../../utils/piiCrypto';
import {
  assertInScopeOrDeny,
  denyAsNotFound,
  scopedWhere,
  type AccessContext,
} from '../access-control/accessScope';
import type { ScreeningPolicySettings } from '../screening/protocolSelection';
import { generateResultRun } from './resultGeneration';

export interface ResultsServiceDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  screeningPolicy: ScreeningPolicySettings;
}

const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

export const runInclude = {
  session: { select: { childId: true, child: { select: { fullName: true } } } },
  generatedBy: { select: { displayName: true } },
  review: { select: { id: true, status: true, decision: true, decidedAt: true } },
  results: {
    include: {
      ruleSet: true,
      protocol: { select: { id: true, code: true, version: true, isDemonstration: true } },
      sessionCategory: { select: { protocolStatusAtStart: true } },
    },
    orderBy: { category: 'asc' },
  },
} satisfies Prisma.ScreeningResultRunInclude;
type RunRow = Prisma.ScreeningResultRunGetPayload<{ include: typeof runInclude }>;

const isOperational = (r: Pick<ClinicalRuleSet, 'status' | 'isDemonstration' | 'approvedById'>) =>
  r.status === 'ACTIVE' && !r.isDemonstration && r.approvedById !== null;

function rulesOf(ruleSet: ClinicalRuleSet | null) {
  if (!ruleSet)
    return new Map<string, ReturnType<typeof storedRuleDefinitionSchema.parse>['rules'][number]>();
  return new Map(storedRuleDefinitionSchema.parse(ruleSet.definition).rules.map((r) => [r.ruleId, r]));
}

function toCategoryResult(r: RunRow['results'][number]): CategoryResult {
  const rules = rulesOf(r.ruleSet);
  const evaluations = r.evidence as unknown as RuleEvaluation[];
  return {
    id: r.id,
    category: r.category,
    outcome: r.outcome,
    sessionCategoryId: r.sessionCategoryId,
    protocol:
      r.protocol && r.sessionCategory
        ? { ...r.protocol, statusAtStart: r.sessionCategory.protocolStatusAtStart }
        : null,
    ruleSet: r.ruleSet
      ? {
          id: r.ruleSet.id,
          code: r.ruleSet.code,
          version: r.ruleSet.version,
          status: r.ruleSet.status,
          isDemonstration: r.ruleSet.isDemonstration,
          isOperational: isOperational(r.ruleSet),
        }
      : null,
    referralRecommended: r.referralRecommended,
    suggestedPriority: r.suggestedPriority,
    rules: evaluations.map((e) => {
      const rule = rules.get(e.ruleId)!;
      return {
        ruleId: e.ruleId,
        name: rule.name,
        clinicalReference: rule.clinicalReference,
        outcomeIfMet: rule.outcome,
        result: e.result,
        evidence: e.evidence,
      };
    }),
    limitations: r.limitations as unknown as ResultLimitation[],
  };
}

function toSummary(run: RunRow): ResultRunSummary {
  return {
    id: run.id,
    sessionId: run.sessionId,
    childId: run.session.childId,
    childName: run.session.child.fullName,
    screeningVersion: run.screeningVersion,
    isCurrent: run.supersededAt === null,
    supersededAt: run.supersededAt?.toISOString() ?? null,
    overallOutcome: run.overallOutcome,
    usesUnapprovedContent: run.usesUnapprovedContent,
    engineVersion: run.engineVersion,
    generatedAt: run.generatedAt.toISOString(),
    generatedByName: run.generatedBy?.displayName ?? null,
    review: run.review
      ? {
          id: run.review.id,
          status: run.review.status,
          decision: run.review.decision,
          decidedAt: run.review.decidedAt?.toISOString() ?? null,
        }
      : null,
    categoryOutcomes: run.results.map((r) => ({ category: r.category, outcome: r.outcome })),
  };
}

export function toRun(run: RunRow): ResultRun {
  const { categoryOutcomes: _omit, ...summary } = toSummary(run);
  return { ...summary, categories: run.results.map(toCategoryResult) };
}

function toRuleSetSummary(
  r: ClinicalRuleSet & { approvedBy: { displayName: string } | null },
): ClinicalRuleSetSummary {
  return {
    id: r.id,
    code: r.code,
    version: r.version,
    category: r.category,
    protocolCode: r.protocolCode,
    protocolVersions: r.protocolVersions,
    name: { hi: r.nameHi, en: r.nameEn },
    ageMinDays: r.ageMinDays,
    ageMaxDays: r.ageMaxDays,
    sourceReference: r.sourceReference,
    status: r.status,
    isDemonstration: r.isDemonstration,
    contentSha256: r.contentSha256,
    approvedByName: r.approvedBy?.displayName ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    approvalReference: r.approvalReference,
    effectiveFrom: r.effectiveFrom?.toISOString() ?? null,
    retiredAt: r.retiredAt?.toISOString() ?? null,
    isOperational: isOperational(r),
  };
}

/**
 * Screening results (Step 7 decisions E-F) and the read-only rule-set catalogue (decision B).
 * Results are readable with child.read inside the caller's area scope (R6); out of scope and
 * missing look the same (404 + DENIED audit, R11).
 */
export function createResultsService({ db, pii, screeningPolicy }: ResultsServiceDependencies) {
  const at = (ctx: AccessContext) => ctx.at ?? new Date();

  async function loadRun(id: string): Promise<ResultRun> {
    return toRun(await db.screeningResultRun.findUniqueOrThrow({ where: { id }, include: runInclude }));
  }

  return {
    async forSession(ctx: AccessContext, sessionId: string): Promise<SessionResultsResponse> {
      await assertInScopeOrDeny(db, ctx, 'screeningSession', sessionId, 'child.read');
      const runs = await db.screeningResultRun.findMany({
        where: { sessionId },
        include: runInclude,
        orderBy: { screeningVersion: 'desc' },
      });
      const current = runs.find((r) => r.supersededAt === null) ?? null;
      return { current: current ? toRun(current) : null, history: runs.map(toSummary) };
    },

    async get(ctx: AccessContext, id: string): Promise<ResultRun> {
      await assertInScopeOrDeny(db, ctx, 'screeningResultRun', id, 'child.read');
      return loadRun(id);
    },

    async list(ctx: AccessContext, query: ResultListQuery): Promise<ResultListResponse> {
      // AND, never a spread: the child filter must not replace the scope filter on `session`.
      const where: Prisma.ScreeningResultRunWhereInput = {
        AND: [
          scopedWhere.screeningResultRun(ctx.userId, 'child.read', at(ctx)),
          { supersededAt: null },
          query.outcome ? { overallOutcome: query.outcome } : {},
          query.reviewStatus ? { review: { status: query.reviewStatus } } : {},
          query.childId ? { session: { childId: query.childId } } : {},
        ],
      };
      const [rows, total] = await Promise.all([
        db.screeningResultRun.findMany({
          where,
          include: runInclude,
          orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.screeningResultRun.count({ where }),
      ]);
      return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
    },

    /**
     * Generates the result of the CURRENT version if it does not exist yet (sessions completed
     * before Step 7). Idempotent. Draft and cancelled screenings are refused (409).
     */
    async generate(ctx: AccessContext, sessionId: string): Promise<GenerateResultResponse> {
      let permitted = false;
      for (const permission of ['screening.conduct', 'screening.review'] as const) {
        const count = await db.screeningSession.count({
          where: { id: sessionId, ...scopedWhere.screeningSession(ctx.userId, permission, at(ctx)) },
        });
        if (count > 0) {
          permitted = true;
          break;
        }
      }
      if (!permitted) {
        const exists = (await db.screeningSession.count({ where: { id: sessionId } })) > 0;
        throw await denyAsNotFound(db, ctx, 'screeningSession', sessionId, 'screening.conduct', exists);
      }
      const outcome = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ScreeningSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
        const session = await tx.screeningSession.findUniqueOrThrow({ where: { id: sessionId } });
        if (session.status !== 'COMPLETED') {
          throw AppError.conflict(
            'SCREENING_NOT_COMPLETED',
            'Results are generated only for completed screenings.',
            { status: session.status },
          );
        }
        return generateResultRun(
          tx,
          { pii, screeningPolicy },
          { sessionId, generatedById: ctx.userId, now: at(ctx), requestId: ctx.requestId },
        );
      }, TX_OPTIONS);
      return { result: await loadRun(outcome.runId), replayed: !outcome.created };
    },

    // ------------------------------------------------------------ rule-set catalogue

    async ruleSets(query: ClinicalRuleSetListQuery): Promise<{ items: ClinicalRuleSetSummary[] }> {
      const rows = await db.clinicalRuleSet.findMany({
        where: {
          ...(query.category && { category: query.category }),
          ...(query.status && { status: query.status }),
        },
        include: { approvedBy: { select: { displayName: true } } },
        orderBy: [{ category: 'asc' }, { code: 'asc' }, { version: 'desc' }],
        take: 200,
      });
      return { items: rows.map(toRuleSetSummary) };
    },

    async ruleSet(id: string): Promise<{ ruleSet: ClinicalRuleSetDetail }> {
      const row = await db.clinicalRuleSet.findUnique({
        where: { id },
        include: {
          approvedBy: { select: { displayName: true } },
          events: { include: { actor: { select: { displayName: true } } }, orderBy: { occurredAt: 'asc' } },
        },
      });
      if (!row) throw AppError.notFound('Rule set not found');
      const rules = storedRuleDefinitionSchema.parse(row.definition).rules;
      return {
        ruleSet: {
          ...toRuleSetSummary(row),
          rules: rules.map((r) => ({
            ruleId: r.ruleId,
            name: r.name,
            clinicalReference: r.clinicalReference,
            ageMinDays: r.ageMinDays ?? row.ageMinDays,
            ageMaxDays: r.ageMaxDays ?? row.ageMaxDays,
            when: r.when,
            inputs: conditionInputs(r.when),
            outcome: r.outcome,
            referralRecommended: r.referralRecommended,
            suggestedPriority: r.suggestedPriority ?? null,
          })),
          history: row.events.map((e) => ({
            type: e.type,
            fromStatus: e.fromStatus,
            toStatus: e.toStatus,
            actorName: e.actor?.displayName ?? 'System (development seed)',
            reference: e.reference,
            contentSha256: e.contentSha256,
            occurredAt: e.occurredAt.toISOString(),
          })),
        },
      };
    },
  };
}
