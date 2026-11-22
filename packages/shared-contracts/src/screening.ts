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

// =====================================================================================
// Sessions (stage 6C). Every write carries the session `expectedVersion` the client last saw:
// a stale write is refused with 409 VERSION_CONFLICT instead of overwriting newer data.
// Server-derived values (worker, age, area, consent, timestamps, completion state) are never
// accepted from the client: strict schemas reject unknown fields (mass assignment).
// =====================================================================================

export const SESSION_STATUSES = ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const CATEGORY_PROGRESS = ['IN_PROGRESS', 'COMPLETED'] as const;

const expectedVersionSchema = z.number().int().min(1);
const notesSchema = z.string().trim().min(1).max(500);

export const startScreeningRequestSchema = z.strictObject({
  clientOperationId: z.uuid(),
  childId: z.uuid(),
});
export type StartScreeningRequest = z.infer<typeof startScreeningRequestSchema>;

export const startCategoryRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  category: fourDCategorySchema,
});
export type StartCategoryRequest = z.infer<typeof startCategoryRequestSchema>;

/** Value of an ANSWERED response; its type must match the question's answer type. */
export const responseValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(2000),
  z.array(z.string().max(64)).min(1).max(20),
]);
export type ResponseValue = z.infer<typeof responseValueSchema>;

export const responseInputSchema = z
  .strictObject({
    questionId: z.uuid(),
    status: observationStatusSchema,
    source: responseSourceSchema,
    value: responseValueSchema.optional(),
    notAssessedReason: z.string().trim().min(1).max(200).optional(),
    notes: notesSchema.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.status === 'ANSWERED' && r.value === undefined) {
      ctx.addIssue({ code: 'custom', message: 'An answered question needs a value', path: ['value'] });
    }
    if (r.status !== 'ANSWERED' && r.value !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Only an answered question has a value', path: ['value'] });
    }
    if (r.notAssessedReason && r.status !== 'NOT_ASSESSED' && r.status !== 'UNABLE_TO_ASSESS') {
      ctx.addIssue({
        code: 'custom',
        message: 'A reason is only for not assessed / unable to assess',
        path: ['notAssessedReason'],
      });
    }
  });
export type ResponseInput = z.infer<typeof responseInputSchema>;

/** Saves one section: upserts `responses`; `cleared` returns questions to "not answered". */
export const saveResponsesRequestSchema = z
  .strictObject({
    expectedVersion: expectedVersionSchema,
    responses: z.array(responseInputSchema).max(100).default([]),
    cleared: z.array(z.uuid()).max(100).default([]),
  })
  .superRefine((r, ctx) => {
    const ids = [...r.responses.map((x) => x.questionId), ...r.cleared];
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Each question may appear only once', path: ['responses'] });
    }
    if (ids.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Nothing to save', path: ['responses'] });
    }
  });
export type SaveResponsesRequest = z.input<typeof saveResponsesRequestSchema>;

export const updateCategoryRequestSchema = z
  .strictObject({
    expectedVersion: expectedVersionSchema,
    /** COMPLETED = finish the category; IN_PROGRESS = reopen it while the session is open. */
    status: z.enum(CATEGORY_PROGRESS).optional(),
    /** Category-level worker observations; null clears them. */
    notes: notesSchema.nullable().optional(),
  })
  .refine((r) => r.status !== undefined || r.notes !== undefined, { message: 'Nothing to update' });
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

// -------------------------------------------------------------------- measurements

/** Measurement types offered in Step 6 (decision I). HAEMOGLOBIN is not offered. */
export const SCREENING_MEASUREMENT_TYPES = [
  'WEIGHT',
  'HEIGHT',
  'LENGTH',
  'MUAC',
  'HEAD_CIRCUMFERENCE',
] as const;
export const screeningMeasurementTypeSchema = z.enum(SCREENING_MEASUREMENT_TYPES);
export type ScreeningMeasurementType = z.infer<typeof screeningMeasurementTypeSchema>;

export const MEASUREMENT_UNITS = ['kg', 'g', 'cm', 'mm'] as const;
export const measurementUnitSchema = z.enum(MEASUREMENT_UNITS);
export type MeasurementUnit = z.infer<typeof measurementUnitSchema>;

export const MEASUREMENT_SOURCES = ['MEASURED', 'GUARDIAN_REPORTED', 'FROM_RECORD'] as const;
export const MEASUREMENT_QUALITIES = ['RELIABLE', 'QUESTIONABLE', 'NOT_RELIABLE'] as const;

/**
 * A measurement value is a plain decimal STRING ("12.35"), so it is stored exactly as entered:
 * no binary floating point, no "NaN", no "Infinity", no exponent, no sign. Unit-specific
 * precision and plausibility are checked by the server.
 */
export const decimalStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,5})(\.\d{1,3})?$/, 'Enter a number such as 12.5 (no signs, spaces or letters)');

const measurementFields = {
  value: decimalStringSchema,
  unit: measurementUnitSchema,
  source: z.enum(MEASUREMENT_SOURCES),
  quality: z.enum(MEASUREMENT_QUALITIES),
  /** When it was measured (ISO date-time with offset). Not in the future. */
  measuredAt: z.iso.datetime({ offset: true }),
  method: z.string().trim().min(1).max(64).optional(),
  deviceMake: z.string().trim().min(1).max(64).optional(),
  deviceModel: z.string().trim().min(1).max(64).optional(),
  deviceSerial: z.string().trim().min(1).max(64).optional(),
  notes: notesSchema.optional(),
};

export const addMeasurementRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  type: screeningMeasurementTypeSchema,
  ...measurementFields,
});
export type AddMeasurementRequest = z.infer<typeof addMeasurementRequestSchema>;

/** A correction keeps the original row and adds a superseding one (the type cannot change). */
export const correctMeasurementRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  correctionReason: z.string().trim().min(3).max(200),
  ...measurementFields,
});
export type CorrectMeasurementRequest = z.infer<typeof correctMeasurementRequestSchema>;

// ------------------------------------------------------------------------ lifecycle

export const completeSessionRequestSchema = z.strictObject({ expectedVersion: expectedVersionSchema });
export type CompleteSessionRequest = z.infer<typeof completeSessionRequestSchema>;

export const cancelSessionRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  /** Short, no personal data. */
  reason: z.string().trim().min(3).max(200),
});
export type CancelSessionRequest = z.infer<typeof cancelSessionRequestSchema>;

export const screeningListQuerySchema = z.strictObject({
  status: sessionStatusSchema.optional(),
  childId: z.uuid().optional(),
  /** Only sessions conducted by the caller. */
  mine: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ScreeningListQuery = z.infer<typeof screeningListQuerySchema>;

export const screeningHistoryQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ScreeningHistoryQuery = z.infer<typeof screeningHistoryQuerySchema>;

// ------------------------------------------------------------------------ responses

export const categoryCompletenessSchema = z.object({
  totalQuestions: z.number(),
  requiredQuestions: z.number(),
  /** Required questions with an explicit state (answer, unknown, not assessed, unable). */
  requiredAddressed: z.number(),
  answered: z.number(),
  unknown: z.number(),
  notAssessed: z.number(),
  /** Questions with no record at all. Never counted as "No". */
  notAnswered: z.number(),
});
export type CategoryCompleteness = z.infer<typeof categoryCompletenessSchema>;

export const screeningResponseSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  questionCode: z.string(),
  status: observationStatusSchema,
  source: responseSourceSchema,
  value: responseValueSchema.nullable(),
  notAssessedReason: z.string().nullable(),
  notes: z.string().nullable(),
  recordedAt: z.string(),
  updatedAt: z.string(),
  recordedByName: z.string(),
});
export type ScreeningResponse = z.infer<typeof screeningResponseSchema>;

export const sessionCategorySchema = z.object({
  id: z.string(),
  category: fourDCategorySchema,
  status: z.enum(CATEGORY_PROGRESS),
  protocol: screeningProtocolSummarySchema,
  protocolStatusAtStart: protocolStatusSchema,
  /** True only if ACTIVE, non-demonstration content was used. */
  usedApprovedContent: z.boolean(),
  notes: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  completeness: categoryCompletenessSchema,
  responses: z.array(screeningResponseSchema),
});
export type SessionCategory = z.infer<typeof sessionCategorySchema>;

export const screeningMeasurementSchema = z.object({
  id: z.string(),
  type: z.string(),
  /** Exactly as entered. */
  value: z.string(),
  unit: z.string(),
  /** Explicit conversion for display (kg or cm); the stored value is never converted. */
  converted: z.object({ value: z.string(), unit: z.string() }),
  source: z.string(),
  quality: z.string(),
  method: z.string().nullable(),
  deviceMake: z.string().nullable(),
  deviceModel: z.string().nullable(),
  deviceSerial: z.string().nullable(),
  notes: z.string().nullable(),
  measuredAt: z.string(),
  recordedAt: z.string(),
  recordedByName: z.string(),
  supersedesId: z.string().nullable(),
  correctionReason: z.string().nullable(),
  /** False when a later correction replaced it (it stays in the history). */
  isCurrent: z.boolean(),
});
export type ScreeningMeasurement = z.infer<typeof screeningMeasurementSchema>;

export const screeningSessionSummarySchema = z.object({
  id: z.string(),
  childId: z.string(),
  childName: z.string(),
  status: sessionStatusSchema,
  version: z.number(),
  /** India calendar date the screening started. */
  screeningDate: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  conductedByName: z.string(),
  isMine: z.boolean(),
  ageInDaysAtStart: z.number(),
  dobEstimatedAtStart: z.boolean(),
  categories: z.array(z.object({ category: fourDCategorySchema, status: z.enum(CATEGORY_PROGRESS) })),
  usesUnapprovedContent: z.boolean(),
});
export type ScreeningSessionSummary = z.infer<typeof screeningSessionSummarySchema>;

export const screeningSessionDetailSchema = screeningSessionSummarySchema.extend({
  dateOfBirthAtStart: z.string(),
  ageAtStart: z.object({ years: z.number(), months: z.number() }),
  screeningConsentId: z.string(),
  cancelReason: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  /** True for the conducting worker while the session is open. */
  canEdit: z.boolean(),
  sessionCategories: z.array(sessionCategorySchema),
  /** Four-D categories never started in this session: reported as NOT assessed. */
  categoriesNotAssessed: z.array(fourDCategorySchema),
  measurements: z.array(screeningMeasurementSchema),
  /**
   * Always false in Step 6: no approved screening rules exist, so no outcome or referral
   * recommendation is generated (decision P).
   */
  screeningRulesApplied: z.literal(false),
});
export type ScreeningSessionDetail = z.infer<typeof screeningSessionDetailSchema>;

export const screeningSessionResponseSchema = z.object({ session: screeningSessionDetailSchema });
export type ScreeningSessionResponse = z.infer<typeof screeningSessionResponseSchema>;

export const screeningListResponseSchema = z.object({
  items: z.array(screeningSessionSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type ScreeningListResponse = z.infer<typeof screeningListResponseSchema>;

/** GET /screenings/summary - the caller's own real counts (never estimated). */
export const screeningDashboardSummarySchema = z.object({
  date: z.string(),
  completedToday: z.number(),
  inProgress: z.number(),
  drafts: z.number(),
});
export type ScreeningDashboardSummary = z.infer<typeof screeningDashboardSummarySchema>;
