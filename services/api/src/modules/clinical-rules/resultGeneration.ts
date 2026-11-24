import { FOUR_D_CATEGORIES, type EvidenceRef, type FourDCategoryCode } from '@balswasthya/shared-contracts';
import type { ClinicalRuleSet, Prisma } from '@prisma/client';
import { logger } from '../../utils/logger';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { recordAudit } from '../audit/audit.service';
import { currentState, type CurrentResponse } from '../screening/amendmentOverlay';
import type { ScreeningPolicySettings } from '../screening/protocolSelection';
import { sessionTextSealer } from '../screening/sensitiveText';
import { detailInclude } from '../screening/sessionDto';
import {
  ENGINE_VERSION,
  evaluateCategory,
  overallOutcome,
  type CategoryInput,
  type EvaluationMeasurement,
  type EvaluationResponse,
  type ObservationState,
  type RuleSetChoice,
} from './evaluator';
import { ruleSetContentHash, ruleSetRowToDefinition } from './ruleSetContent';

type Tx = Prisma.TransactionClient;

export interface GenerationDependencies {
  pii: PiiCrypto;
  screeningPolicy: ScreeningPolicySettings;
}

export interface GenerationRequest {
  sessionId: string;
  /** null = automatic (completion / amendment). */
  generatedById: string | null;
  now: Date;
  requestId?: string;
}

/**
 * Rule set for one category (Step 7 decision F). Mirrors protocol selection (Step 6):
 *  - an ACTIVE rule set whose effective date has passed wins;
 *  - DRAFT rule sets (incl. demonstration) only where draft content is allowed (never production),
 *    latest version per code; two different codes = AMBIGUOUS (configuration error, never picked);
 *  - IN_REVIEW, APPROVED-but-not-active and RETIRED sets are never used;
 *  - a set whose stored content no longer matches its reviewed hash is never used (logged).
 */
export function chooseRuleSet(
  candidates: readonly ClinicalRuleSet[],
  policy: ScreeningPolicySettings,
  now: Date,
): { choice: RuleSetChoice; row: ClinicalRuleSet | null } {
  const active = candidates.filter(
    (r) => r.status === 'ACTIVE' && r.effectiveFrom !== null && r.effectiveFrom.getTime() <= now.getTime(),
  );
  let picked: ClinicalRuleSet | null = null;
  if (active.length > 1) return { choice: { kind: 'AMBIGUOUS' }, row: null };
  if (active.length === 1) picked = active[0]!;
  if (!picked && policy.allowDraftProtocols) {
    const latest = new Map<string, ClinicalRuleSet>();
    for (const r of candidates.filter((c) => c.status === 'DRAFT')) {
      const current = latest.get(r.code);
      if (!current || r.version > current.version) latest.set(r.code, r);
    }
    if (latest.size > 1) return { choice: { kind: 'AMBIGUOUS' }, row: null };
    picked = [...latest.values()][0] ?? null;
  }
  if (!picked) return { choice: { kind: 'NONE' }, row: null };

  try {
    const def = ruleSetRowToDefinition(picked);
    if (picked.status !== 'DRAFT' && ruleSetContentHash(def) !== picked.contentSha256) {
      logger.error('rule_set_content_mismatch', { ruleSetId: picked.id });
      return { choice: { kind: 'NONE' }, row: null };
    }
    return {
      choice: {
        kind: 'RULE_SET',
        approved: picked.status === 'ACTIVE' && !picked.isDemonstration,
        definition: { dslVersion: def.dslVersion, rules: def.rules },
      },
      row: picked,
    };
  } catch {
    logger.error('rule_set_definition_invalid', { ruleSetId: picked.id });
    return { choice: { kind: 'NONE' }, row: null };
  }
}

/**
 * Creates the result run for the CURRENT version of a COMPLETED screening, inside the caller's
 * transaction, together with its four category results, the clinical review task (decision G),
 * the supersede mark on the previous version's run and the audit record. Idempotent: if the run
 * for this version exists it is returned unchanged (`created: false`).
 *
 * Callers hold the session row lock (completion, amendment, or the explicit generate endpoint).
 */
export async function generateResultRun(
  tx: Tx,
  deps: GenerationDependencies,
  req: GenerationRequest,
): Promise<{ runId: string; created: boolean }> {
  const row = await tx.screeningSession.findUniqueOrThrow({
    where: { id: req.sessionId },
    include: { ...detailInclude, child: { select: { fullName: true, areaId: true } } },
  });
  if (row.status !== 'COMPLETED') {
    throw new Error(`Result generation requires a COMPLETED screening (was ${row.status})`);
  }
  const screeningVersion = row.amendments.length + 1;
  const existing = await tx.screeningResultRun.findUnique({
    where: { sessionId_screeningVersion: { sessionId: row.id, screeningVersion } },
    select: { id: true },
  });
  if (existing) return { runId: existing.id, created: false };

  const state = currentState(row, sessionTextSealer(deps.pii, row.id));

  // Latest amendment change per measurement: the evidence for an amended value.
  const measurementChange = new Map<string, string>();
  for (const a of row.amendments) {
    for (const c of a.changes)
      if (c.kind === 'MEASUREMENT' && c.measurementId) measurementChange.set(c.measurementId, c.id);
  }
  const measurements: EvaluationMeasurement[] = row.measurements
    .filter((m) => m.supersededBy === null)
    .map((m) => {
      const current = state.measurements.get(m.id)!;
      const changeId = current.amended ? measurementChange.get(m.id) : undefined;
      return {
        type: m.type,
        value: current.record.value,
        unit: current.record.unit,
        quality: current.record.quality,
        ref: changeId ? { kind: 'amendmentChange', id: changeId } : { kind: 'measurement', id: m.id },
      };
    });

  const ruleSets = await tx.clinicalRuleSet.findMany({
    where: {
      status: { in: ['ACTIVE', 'DRAFT'] },
      ageMinDays: { lte: row.ageInDaysAtStart },
      ageMaxDays: { gte: row.ageInDaysAtStart },
    },
  });

  const results: Prisma.ScreeningResultCreateManyInput[] = [];
  const runId = crypto.randomUUID();
  let usesUnapprovedContent = false;
  for (const category of FOUR_D_CATEGORIES as readonly FourDCategoryCode[]) {
    const cat = row.categories.find((c) => c.category === category);
    if (!cat) {
      const evaluation = evaluateCategory(
        {
          ageInDays: row.ageInDaysAtStart,
          categoryStatus: 'NOT_STARTED',
          protocolApproved: false,
          questions: new Map(),
          responses: new Map(),
          measurements,
        },
        { kind: 'NONE' },
      );
      results.push({
        resultRunId: runId,
        sessionId: row.id,
        category,
        outcome: evaluation.outcome,
        source: 'RULE_ENGINE',
        evidence: [],
        limitations: evaluation.limitations,
      });
      continue;
    }

    const protocolApproved = cat.protocolStatusAtStart === 'ACTIVE' && !cat.protocol.isDemonstration;
    const questions = new Map(cat.protocol.questions.map((q) => [q.code, { answerType: q.answerType }]));
    const codeOf = new Map(cat.protocol.questions.map((q) => [q.id, q.code]));
    const responses = new Map<string, EvaluationResponse>();
    for (const [questionId, r] of state.responses.get(cat.id) ?? new Map<string, CurrentResponse>()) {
      const ref: EvidenceRef = { kind: r.amended ? 'amendmentChange' : 'observation', id: r.id };
      responses.set(codeOf.get(questionId)!, {
        status: r.record.status as ObservationState,
        value: r.record.value,
        ref,
      });
    }
    const input: CategoryInput = {
      ageInDays: row.ageInDaysAtStart,
      categoryStatus: cat.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
      protocolApproved,
      questions,
      responses,
      measurements,
    };
    const candidates = ruleSets.filter(
      (r) =>
        r.category === category &&
        r.protocolCode === cat.protocol.code &&
        r.protocolVersions.includes(cat.protocol.version),
    );
    const { choice, row: ruleSet } = chooseRuleSet(candidates, deps.screeningPolicy, req.now);
    const evaluation = evaluateCategory(input, choice);
    if (!protocolApproved || (choice.kind === 'RULE_SET' && !choice.approved)) usesUnapprovedContent = true;
    results.push({
      resultRunId: runId,
      sessionId: row.id,
      category,
      sessionCategoryId: cat.id,
      protocolId: cat.protocolId,
      ruleSetId: ruleSet?.id ?? null,
      outcome: evaluation.outcome,
      source: 'RULE_ENGINE',
      evidence: evaluation.evaluations,
      limitations: evaluation.limitations,
      referralRecommended: evaluation.referralRecommended,
      suggestedPriority: evaluation.suggestedPriority,
    });
  }

  const overall = overallOutcome(results.map((r) => r.outcome));
  await tx.screeningResultRun.updateMany({
    where: { sessionId: row.id, supersededAt: null },
    data: { supersededAt: req.now },
  });
  await tx.screeningResultRun.create({
    data: {
      id: runId,
      sessionId: row.id,
      screeningVersion,
      overallOutcome: overall,
      usesUnapprovedContent,
      engineVersion: ENGINE_VERSION,
      generatedById: req.generatedById,
      generatedAt: req.now,
    },
  });
  await tx.screeningResult.createMany({ data: results });
  // Decision G: every result run gets a clinical review task (until the programme narrows this).
  const review = await tx.clinicalReview.create({
    data: { resultRunId: runId, areaId: row.child.areaId },
  });
  await tx.clinicalReviewEvent.create({
    data: { reviewId: review.id, toStatus: 'PENDING_REVIEW' },
  });
  await recordAudit(tx, {
    actorUserId: req.generatedById ?? undefined,
    action: 'screening.result_generated',
    entityType: 'screeningResultRun',
    entityId: runId,
    areaId: row.child.areaId,
    outcome: 'SUCCESS',
    requestId: req.requestId,
    // Outcome labels and identifiers only - no answers or values.
    details: {
      sessionId: row.id,
      screeningVersion,
      overallOutcome: overall,
      categoryOutcomes: Object.fromEntries(results.map((r) => [r.category, r.outcome])),
      ruleSetIds: results.map((r) => r.ruleSetId ?? null).filter((id): id is string => id !== null),
      usesUnapprovedContent,
      engineVersion: ENGINE_VERSION,
      trigger: req.generatedById ? 'explicit' : 'automatic',
      reviewId: review.id,
    },
  });
  return { runId, created: true };
}
