import { z } from 'zod';
import { consentPurposeStatusSchema } from './consent.js';

/**
 * Four-D screening contracts (Step 6; docs/step-6/initial-audit.md decisions A-U).
 *
 * SCREENING SUPPORT, NOT DIAGNOSIS. Nothing in these contracts carries a diagnosis, a clinical
 * classification or a recommendation. Clinical content (questions, age bands, rules) is DATA
 * that belongs to a versioned protocol with an approval status; the software never invents it.
 */

export const FOUR_D_CATEGORIES = [
  'DEFECTS_AT_BIRTH',
  'DEFICIENCIES',
  'DISEASES',
  'DEVELOPMENTAL_DELAYS_DISABILITIES',
] as const;
export const fourDCategorySchema = z.enum(FOUR_D_CATEGORIES);
export type FourDCategoryCode = z.infer<typeof fourDCategorySchema>;

/** Lifecycle (decision B). Only ACTIVE protocols are operational. */
export const PROTOCOL_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED'] as const;
export const protocolStatusSchema = z.enum(PROTOCOL_STATUSES);
export type ProtocolStatus = z.infer<typeof protocolStatusSchema>;

export const ANSWER_TYPES = ['YES_NO', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'NUMBER', 'TEXT'] as const;
export const answerTypeSchema = z.enum(ANSWER_TYPES);
export type AnswerType = z.infer<typeof answerTypeSchema>;

/**
 * Explicit answer states (decision G). An unanswered question has no record at all; UNKNOWN and
 * NOT_ASSESSED are never "No".
 */
export const OBSERVATION_STATUSES = ['ANSWERED', 'UNKNOWN', 'NOT_ASSESSED', 'UNABLE_TO_ASSESS'] as const;
export const observationStatusSchema = z.enum(OBSERVATION_STATUSES);
export type ObservationStatus = z.infer<typeof observationStatusSchema>;

export const RESPONSE_SOURCES = ['WORKER_OBSERVED', 'GUARDIAN_REPORTED'] as const;
export const responseSourceSchema = z.enum(RESPONSE_SOURCES);

// ----------------------------------------------------------------- protocol content

/** Approved wording in both product languages (decision C). Both are required. */
export const localizedTextSchema = z.strictObject({
  hi: z.string().trim().min(1).max(1000),
  en: z.string().trim().min(1).max(1000),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

const codeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'Codes are upper-case letters, digits and underscores');

export const choiceOptionSchema = z.strictObject({ code: codeSchema, label: localizedTextSchema });
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

/**
 * Input rules a protocol may set for a question. These are DATA-ENTRY rules from the protocol
 * (e.g. "duration in days, 0-365, whole number"), not clinical thresholds.
 */
export const questionValidationSchema = z
  .strictObject({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    maxDecimals: z.number().int().min(0).max(3).optional(),
    unit: z.string().trim().min(1).max(16).optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
  })
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, {
    message: 'min must not exceed max',
  });
export type QuestionValidation = z.infer<typeof questionValidationSchema>;

const CHOICE_TYPES: ReadonlySet<AnswerType> = new Set(['SINGLE_CHOICE', 'MULTI_CHOICE']);

export const protocolQuestionDefinitionSchema = z
  .strictObject({
    code: codeSchema,
    sectionCode: codeSchema,
    sortOrder: z.number().int().min(0),
    prompt: localizedTextSchema,
    help: localizedTextSchema.optional(),
    answerType: answerTypeSchema,
    options: z.array(choiceOptionSchema).optional(),
    validation: questionValidationSchema.optional(),
    isRequired: z.boolean(),
  })
  .superRefine((q, ctx) => {
    const isChoice = CHOICE_TYPES.has(q.answerType);
    if (isChoice && (!q.options || q.options.length < 2)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Choice questions need at least two options',
        path: ['options'],
      });
    }
    if (!isChoice && q.options) {
      ctx.addIssue({ code: 'custom', message: 'Only choice questions have options', path: ['options'] });
    }
    if (q.options && new Set(q.options.map((o) => o.code)).size !== q.options.length) {
      ctx.addIssue({ code: 'custom', message: 'Option codes must be unique', path: ['options'] });
    }
    const v = q.validation;
    if (v) {
      const numeric = v.min !== undefined || v.max !== undefined || v.maxDecimals !== undefined || v.unit;
      if (numeric && q.answerType !== 'NUMBER') {
        ctx.addIssue({
          code: 'custom',
          message: 'Number rules apply to NUMBER questions only',
          path: ['validation'],
        });
      }
      if (v.maxLength !== undefined && q.answerType !== 'TEXT') {
        ctx.addIssue({
          code: 'custom',
          message: 'maxLength applies to TEXT questions only',
          path: ['validation'],
        });
      }
    }
  });
export type ProtocolQuestionDefinition = z.infer<typeof protocolQuestionDefinitionSchema>;

/**
 * The complete content of one protocol version: exactly what is hashed, reviewed and approved.
 * Used by the seed and the admin tooling; the database stores the same fields.
 */
export const protocolDefinitionSchema = z
  .strictObject({
    code: codeSchema,
    version: z.number().int().min(1),
    category: fourDCategorySchema,
    name: localizedTextSchema,
    description: localizedTextSchema.optional(),
    /** Inclusive age band in completed days. */
    ageMinDays: z.number().int().min(0),
    ageMaxDays: z.number().int().min(0),
    /** Guideline document, edition and section. Required. */
    sourceReference: z.string().trim().min(1).max(500),
    isDemonstration: z.boolean(),
    questions: z.array(protocolQuestionDefinitionSchema).min(1),
  })
  .superRefine((p, ctx) => {
    if (p.ageMaxDays < p.ageMinDays) {
      ctx.addIssue({
        code: 'custom',
        message: 'ageMaxDays must not be below ageMinDays',
        path: ['ageMaxDays'],
      });
    }
    const codes = p.questions.map((q) => q.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: 'custom', message: 'Question codes must be unique', path: ['questions'] });
    }
  });
export type ProtocolDefinition = z.infer<typeof protocolDefinitionSchema>;

// ---------------------------------------------------------------------- API responses

export const screeningQuestionSchema = z.object({
  id: z.string(),
  code: z.string(),
  sectionCode: z.string(),
  sortOrder: z.number(),
  prompt: localizedTextSchema,
  help: localizedTextSchema.nullable(),
  answerType: answerTypeSchema,
  options: z.array(choiceOptionSchema).nullable(),
  validation: questionValidationSchema.nullable(),
  isRequired: z.boolean(),
});
export type ScreeningQuestion = z.infer<typeof screeningQuestionSchema>;

export const screeningProtocolSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  version: z.number(),
  category: fourDCategorySchema,
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  ageMinDays: z.number(),
  ageMaxDays: z.number(),
  sourceReference: z.string(),
  status: protocolStatusSchema,
  /** Engineering placeholder content: never clinically approved, never operational. */
  isDemonstration: z.boolean(),
  /** True only for ACTIVE (approved) content. The app shows a warning whenever this is false. */
  isClinicallyApproved: z.boolean(),
  approvalReference: z.string().nullable(),
  clinicalApprovedAt: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  retiredAt: z.string().nullable(),
  questionCount: z.number(),
});
export type ScreeningProtocolSummary = z.infer<typeof screeningProtocolSummarySchema>;

export const screeningProtocolDetailSchema = screeningProtocolSummarySchema.extend({
  contentSha256: z.string().nullable(),
  questions: z.array(screeningQuestionSchema),
});
export type ScreeningProtocolDetail = z.infer<typeof screeningProtocolDetailSchema>;

export const screeningProtocolListQuerySchema = z.strictObject({
  category: fourDCategorySchema.optional(),
});
export type ScreeningProtocolListQuery = z.infer<typeof screeningProtocolListQuerySchema>;

export const screeningProtocolListResponseSchema = z.object({
  items: z.array(screeningProtocolSummarySchema),
});
export type ScreeningProtocolListResponse = z.infer<typeof screeningProtocolListResponseSchema>;

export const screeningProtocolDetailResponseSchema = z.object({ protocol: screeningProtocolDetailSchema });
export type ScreeningProtocolDetailResponse = z.infer<typeof screeningProtocolDetailResponseSchema>;

// ------------------------------------------------------------------------ eligibility

/**
 * Why a category cannot be started for this child today.
 * - NO_PROTOCOL_FOR_AGE: no usable protocol covers the child's age (no fallback is guessed).
 * - AMBIGUOUS_PROTOCOL: more than one usable draft covers the age (configuration error).
 */
export const CATEGORY_UNAVAILABLE_REASONS = ['NO_PROTOCOL_FOR_AGE', 'AMBIGUOUS_PROTOCOL'] as const;

export const categoryEligibilitySchema = z.object({
  category: fourDCategorySchema,
  available: z.boolean(),
  reason: z.enum(CATEGORY_UNAVAILABLE_REASONS).nullable(),
  protocol: screeningProtocolSummarySchema.nullable(),
});
export type CategoryEligibility = z.infer<typeof categoryEligibilitySchema>;

/** OPEN_SESSION_EXISTS: resume `openSessionId` instead of starting another session. */
export const SCREENING_BLOCKERS = [
  'CONSENT_NOT_PERMITTED',
  'AGE_NOT_DETERMINABLE',
  'NO_CATEGORY_AVAILABLE',
  'OPEN_SESSION_EXISTS',
] as const;
export type ScreeningBlocker = (typeof SCREENING_BLOCKERS)[number];

/** GET /children/:childId/screening-eligibility. Computed by the server; the app only displays it. */
export const screeningEligibilityResponseSchema = z.object({
  childId: z.string(),
  /** India calendar date the eligibility was evaluated for. */
  screeningDate: z.string(),
  dateOfBirth: z.string(),
  /** True when the date of birth is an estimate: the age is approximate and flagged for review. */
  dobIsEstimated: z.boolean(),
  /** Completed days; null when it cannot be determined (date of birth after the screening date). */
  ageInDays: z.number().nullable(),
  age: z.object({ years: z.number(), months: z.number() }).nullable(),
  consent: consentPurposeStatusSchema,
  /** The open (DRAFT / IN_PROGRESS) session for this child, if any: resume it instead. */
  openSessionId: z.string().nullable(),
  categories: z.array(categoryEligibilitySchema),
  canStart: z.boolean(),
  blockers: z.array(z.enum(SCREENING_BLOCKERS)),
  /** True when any available protocol is not clinically approved (demonstration/draft content). */
  usesUnapprovedContent: z.boolean(),
});
export type ScreeningEligibilityResponse = z.infer<typeof screeningEligibilityResponseSchema>;
