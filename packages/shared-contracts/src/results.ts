import { z } from 'zod';
import { referralPrioritySchema } from './clinicalRules.js';
import { fourDCategorySchema, protocolStatusSchema } from './screening.js';

/**
 * Screening results (Step 7 decisions E-F; docs/step-7/result-generation-architecture.md).
 *
 * A result is an AUTOMATED SCREENING INTERPRETATION of the recorded observations by a versioned
 * rule set - never a diagnosis. It is kept apart from the recorded observations (Step 6) and from
 * the clinician's review (ClinicalReview). With no usable rule set the outcome is NOT_INTERPRETED.
 */

export const RESULT_OUTCOMES = [
  'NO_CONCERN_IN_COMPLETED_ITEMS',
  'FURTHER_EVALUATION_RECOMMENDED',
  'URGENT_EVALUATION_RECOMMENDED',
  'INCOMPLETE',
  'NOT_ASSESSED',
  'UNABLE_TO_DETERMINE',
  'NOT_INTERPRETED',
] as const;
export const resultOutcomeSchema = z.enum(RESULT_OUTCOMES);
export type ResultOutcome = z.infer<typeof resultOutcomeSchema>;

/**
 * Caution order used for the session-level outcome (highest wins). A clean category can never
 * hide a concern, a gap or a missing interpretation in another category.
 */
export const OUTCOME_CAUTION_RANK: Record<ResultOutcome, number> = {
  URGENT_EVALUATION_RECOMMENDED: 7,
  FURTHER_EVALUATION_RECOMMENDED: 6,
  UNABLE_TO_DETERMINE: 5,
  INCOMPLETE: 4,
  NOT_INTERPRETED: 3,
  NOT_ASSESSED: 2,
  NO_CONCERN_IN_COMPLETED_ITEMS: 1,
};

export const RULE_RESULTS = ['MET', 'NOT_MET', 'UNKNOWN', 'NOT_APPLICABLE'] as const;
export const ruleResultSchema = z.enum(RULE_RESULTS);
export type RuleResult = z.infer<typeof ruleResultSchema>;

export const LIMITATION_CODES = [
  'CATEGORY_NOT_STARTED',
  'CATEGORY_INCOMPLETE',
  'NO_USABLE_RULE_SET',
  'AMBIGUOUS_RULE_SET',
  'RULE_SET_NOT_APPROVED',
  'PROTOCOL_NOT_APPROVED',
  'ANSWER_MISSING',
  'ANSWER_UNKNOWN',
  'ANSWER_NOT_ASSESSED',
  'ANSWER_UNABLE_TO_ASSESS',
  'MEASUREMENT_MISSING',
  'MEASUREMENT_NOT_RELIABLE',
  'MEASUREMENT_CONFLICT',
  'UNSUPPORTED_INPUT',
] as const;
export const limitationCodeSchema = z.enum(LIMITATION_CODES);
export type LimitationCode = z.infer<typeof limitationCodeSchema>;

export const resultLimitationSchema = z.object({
  code: limitationCodeSchema,
  ruleId: z.string().optional(),
  question: z.string().optional(),
  measurement: z.string().optional(),
});
export type ResultLimitation = z.infer<typeof resultLimitationSchema>;

export const EVIDENCE_KINDS = ['observation', 'measurement', 'amendmentChange'] as const;
export const evidenceRefSchema = z.object({ kind: z.enum(EVIDENCE_KINDS), id: z.string() });
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

/** Stored per rule in ScreeningResult.evidence: references only, never copied values. */
export const ruleEvaluationSchema = z.object({
  ruleId: z.string(),
  result: ruleResultSchema,
  evidence: z.array(evidenceRefSchema),
});
export type RuleEvaluation = z.infer<typeof ruleEvaluationSchema>;

export const REVIEW_STATUSES = [
  'PENDING_REVIEW',
  'UNDER_REVIEW',
  'ADDITIONAL_INFORMATION_REQUIRED',
  'ESCALATED',
  'REVIEWED',
  'REJECTED',
] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export const REVIEW_DECISIONS = [
  'ACCEPT_RESULT',
  'REQUEST_ADDITIONAL_SCREENING',
  'RECOMMEND_REFERRAL',
  'ESCALATE_FOR_SPECIALIST_REVIEW',
  'REJECT_WITH_REASON',
] as const;
export const reviewDecisionSchema = z.enum(REVIEW_DECISIONS);

export const categoryResultSchema = z.object({
  id: z.string(),
  category: fourDCategorySchema,
  outcome: resultOutcomeSchema,
  sessionCategoryId: z.string().nullable(),
  protocol: z
    .object({
      id: z.string(),
      code: z.string(),
      version: z.number(),
      isDemonstration: z.boolean(),
      statusAtStart: protocolStatusSchema,
    })
    .nullable(),
  ruleSet: z
    .object({
      id: z.string(),
      code: z.string(),
      version: z.number(),
      status: protocolStatusSchema,
      isDemonstration: z.boolean(),
      /** ACTIVE + clinically approved + not demonstration. */
      isOperational: z.boolean(),
    })
    .nullable(),
  referralRecommended: z.boolean(),
  suggestedPriority: referralPrioritySchema.nullable(),
  rules: z.array(
    z.object({
      ruleId: z.string(),
      name: z.object({ hi: z.string(), en: z.string() }),
      clinicalReference: z.string(),
      outcomeIfMet: z.enum(['FURTHER_EVALUATION_RECOMMENDED', 'URGENT_EVALUATION_RECOMMENDED']),
      result: ruleResultSchema,
      evidence: z.array(evidenceRefSchema),
    }),
  ),
  limitations: z.array(resultLimitationSchema),
});
export type CategoryResult = z.infer<typeof categoryResultSchema>;

export const resultRunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  childId: z.string(),
  childName: z.string(),
  /** 1 = as completed; n + 1 after amendment n. */
  screeningVersion: z.number(),
  /** False once the screening was amended and a newer run exists. */
  isCurrent: z.boolean(),
  supersededAt: z.string().nullable(),
  overallOutcome: resultOutcomeSchema,
  usesUnapprovedContent: z.boolean(),
  engineVersion: z.string(),
  generatedAt: z.string(),
  /** null = generated automatically when the screening was completed or amended. */
  generatedByName: z.string().nullable(),
  review: z
    .object({
      id: z.string(),
      status: reviewStatusSchema,
      decision: reviewDecisionSchema.nullable(),
      decidedAt: z.string().nullable(),
    })
    .nullable(),
  /** Always four entries, D1 -> D4. */
  categories: z.array(categoryResultSchema),
});
export type ResultRun = z.infer<typeof resultRunSchema>;

export const resultRunSummarySchema = resultRunSchema.omit({ categories: true }).extend({
  categoryOutcomes: z.array(z.object({ category: fourDCategorySchema, outcome: resultOutcomeSchema })),
});
export type ResultRunSummary = z.infer<typeof resultRunSummarySchema>;

export const sessionResultsResponseSchema = z.object({
  /** The run for the current screening version; null if none was generated yet. */
  current: resultRunSchema.nullable(),
  /** All runs, newest version first (history). */
  history: z.array(resultRunSummarySchema),
});
export type SessionResultsResponse = z.infer<typeof sessionResultsResponseSchema>;

export const resultRunResponseSchema = z.object({ result: resultRunSchema });
export type ResultRunResponse = z.infer<typeof resultRunResponseSchema>;

export const resultListQuerySchema = z.strictObject({
  outcome: resultOutcomeSchema.optional(),
  reviewStatus: reviewStatusSchema.optional(),
  childId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ResultListQuery = z.infer<typeof resultListQuerySchema>;

export const resultListResponseSchema = z.object({
  items: z.array(resultRunSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type ResultListResponse = z.infer<typeof resultListResponseSchema>;

export const generateResultResponseSchema = z.object({
  result: resultRunSchema,
  /** True when the run for the current version already existed (nothing was written). */
  replayed: z.boolean(),
});
export type GenerateResultResponse = z.infer<typeof generateResultResponseSchema>;
