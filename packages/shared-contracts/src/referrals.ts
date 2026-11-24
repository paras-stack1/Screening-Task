import { z } from 'zod';
import { referralPrioritySchema } from './clinicalRules.js';
import { resultOutcomeSchema, resultRunSchema, reviewDecisionSchema, reviewStatusSchema } from './results.js';
import { fourDCategorySchema } from './screening.js';

/**
 * Clinical review, referrals and the facility directory (Step 7 stage 7C; decisions H-P,
 * docs/step-7/clinical-review-workflow.md, referral-workflow.md, facility-management.md).
 *
 * Workflow labels only - nothing here records a diagnosis. Actor, role, status, approval,
 * consent outcome and facility verification are always decided by the server.
 */

const expectedVersionSchema = z.number().int().min(1);
const noteSchema = z.string().trim().min(3).max(1000);

// =============================================================== clinical review

export const reviewEventSchema = z.object({
  fromStatus: reviewStatusSchema.nullable(),
  toStatus: reviewStatusSchema,
  decision: reviewDecisionSchema.nullable(),
  actorName: z.string().nullable(),
  actorRoleCode: z.string().nullable(),
  notes: z.string().nullable(),
  occurredAt: z.string(),
});

export const clinicalReviewSummarySchema = z.object({
  id: z.string(),
  status: reviewStatusSchema,
  version: z.number(),
  resultRunId: z.string(),
  sessionId: z.string(),
  childId: z.string(),
  childName: z.string(),
  screeningVersion: z.number(),
  /** False when the screening was amended after this review task was created. */
  isCurrent: z.boolean(),
  overallOutcome: resultOutcomeSchema,
  usesUnapprovedContent: z.boolean(),
  claimedByName: z.string().nullable(),
  claimedByMe: z.boolean(),
  decision: reviewDecisionSchema.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ClinicalReviewSummary = z.infer<typeof clinicalReviewSummarySchema>;

export const clinicalReviewDetailSchema = clinicalReviewSummarySchema.extend({
  decidedByRoleCode: z.string().nullable(),
  /** Visible to clinical reviewers only (the API answers only screening.review holders). */
  notes: z.string().nullable(),
  /** The reviewer conducted this screening themself. Allowed, but shown. */
  conductedByReviewer: z.boolean(),
  result: resultRunSchema,
  history: z.array(reviewEventSchema),
  referralIds: z.array(z.string()),
  followUpIds: z.array(z.string()),
  canClaim: z.boolean(),
  canRelease: z.boolean(),
  canDecide: z.boolean(),
});
export type ClinicalReviewDetail = z.infer<typeof clinicalReviewDetailSchema>;

export const OPEN_REVIEW_STATUSES = [
  'PENDING_REVIEW',
  'UNDER_REVIEW',
  'ESCALATED',
  'ADDITIONAL_INFORMATION_REQUIRED',
] as const;

export const reviewListQuerySchema = z.strictObject({
  /** Default: the open statuses. */
  status: reviewStatusSchema.optional(),
  /** Include reviews of superseded (amended) screening versions. Default false. */
  includeSuperseded: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

export const reviewListResponseSchema = z.object({
  items: z.array(clinicalReviewSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type ReviewListResponse = z.infer<typeof reviewListResponseSchema>;

export const reviewDetailResponseSchema = z.object({ review: clinicalReviewDetailSchema });
export type ReviewDetailResponse = z.infer<typeof reviewDetailResponseSchema>;

export const reviewVersionRequestSchema = z.strictObject({ expectedVersion: expectedVersionSchema });
export type ReviewVersionRequest = z.infer<typeof reviewVersionRequestSchema>;

/** Workflow reason codes - not clinical classifications. */
export const REFERRAL_REASON_CODES = [
  'RULE_RECOMMENDATION',
  'CLINICAL_REVIEW',
  'WORKER_OBSERVED_CONCERN',
  'GUARDIAN_REPORTED_CONCERN',
  'OTHER',
] as const;
export const referralReasonCodeSchema = z.enum(REFERRAL_REASON_CODES);

export const FOLLOW_UP_REASON_CODES = [
  'ADDITIONAL_SCREENING',
  'REFERRAL_NOT_COMPLETED',
  'FACILITY_REQUESTED_VISIT',
  'CLINICIAN_REQUESTED_ASSESSMENT',
  'PROTOCOL_REASSESSMENT',
] as const;
export const followUpReasonCodeSchema = z.enum(FOLLOW_UP_REASON_CODES);

/** India calendar date, YYYY-MM-DD. */
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const reviewDecisionRequestSchema = z
  .strictObject({
    expectedVersion: expectedVersionSchema,
    decision: reviewDecisionSchema,
    /** Required for every decision except ACCEPT_RESULT. Encrypted; never in notifications. */
    notes: noteSchema.optional(),
    /** RECOMMEND_REFERRAL: the referral the reviewer approves by deciding (decision K). */
    referral: z
      .strictObject({
        category: fourDCategorySchema,
        priority: referralPrioritySchema,
        facilityId: z.uuid().optional(),
        outOfDistrictReason: noteSchema.optional(),
      })
      .optional(),
    /** REQUEST_ADDITIONAL_SCREENING: the follow-up task created by deciding. */
    followUp: z.strictObject({ dueDate: calendarDateSchema }).optional(),
  })
  .superRefine((b, ctx) => {
    if (b.decision !== 'ACCEPT_RESULT' && !b.notes) {
      ctx.addIssue({ code: 'custom', message: 'Notes are required for this decision', path: ['notes'] });
    }
    if ((b.decision === 'RECOMMEND_REFERRAL') !== (b.referral !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A referral is given exactly with RECOMMEND_REFERRAL',
        path: ['referral'],
      });
    }
    if ((b.decision === 'REQUEST_ADDITIONAL_SCREENING') !== (b.followUp !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A follow-up due date is given exactly with REQUEST_ADDITIONAL_SCREENING',
        path: ['followUp'],
      });
    }
  });
export type ReviewDecisionRequest = z.infer<typeof reviewDecisionRequestSchema>;

// =============================================================== facilities

export const FACILITY_TYPES = [
  'DEIC',
  'PHC',
  'CHC',
  'DISTRICT_HOSPITAL',
  'MEDICAL_COLLEGE',
  'DESIGNATED_SPECIALIST_CENTRE',
  'OTHER',
] as const;
export const facilityTypeSchema = z.enum(FACILITY_TYPES);

export const facilitySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
  officialCode: z.string().nullable(),
  type: facilityTypeSchema,
  areaId: z.string(),
  /** Area path from the top, e.g. ["State", "District", "Block"] (English names). */
  areaPath: z.array(z.string()),
  address: z.string().nullable(),
  contactPhone: z.string().nullable(),
  services: z.array(z.string()),
  acceptsReferrals: z.boolean(),
  verificationStatus: z.enum(['UNVERIFIED', 'VERIFIED']),
  isActive: z.boolean(),
});
export type FacilitySummary = z.infer<typeof facilitySummarySchema>;

/** For a child: where the facility is relative to the child's district (decision P). */
export const facilityOptionSchema = facilitySummarySchema.extend({
  placement: z.enum(['IN_DISTRICT', 'OUT_OF_DISTRICT']),
  /** Active, verified and accepting referrals. */
  selectable: z.boolean(),
});
export type FacilityOption = z.infer<typeof facilityOptionSchema>;

export const facilityListQuerySchema = z.strictObject({
  /** Selection mode: facilities for this child's referral. */
  childId: z.uuid().optional(),
  type: facilityTypeSchema.optional(),
  includeOutOfDistrict: z.enum(['true', 'false']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type FacilityListQuery = z.infer<typeof facilityListQuerySchema>;

export const facilityListResponseSchema = z.object({ items: z.array(facilityOptionSchema) });
export type FacilityListResponse = z.infer<typeof facilityListResponseSchema>;

// =============================================================== referrals

export const REFERRAL_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'ISSUED',
  'ACKNOWLEDGED',
  'APPOINTMENT_SCHEDULED',
  'VISITED',
  'VISIT_NOT_COMPLETED',
  'UNDER_TREATMENT',
  'FOLLOW_UP_REQUIRED',
  'CLOSED',
  'CANCELLED',
] as const;
export const referralStatusSchema = z.enum(REFERRAL_STATUSES);
export type ReferralStatus = z.infer<typeof referralStatusSchema>;

export const REFERRAL_ORIGINS = ['CLINICAL_REVIEW', 'RULE_RECOMMENDATION', 'WORKER_CONCERN'] as const;
export const UPDATE_SOURCES = [
  'SYSTEM',
  'APP_USER_DIRECT',
  'FACILITY_PHONE_CALL',
  'FACILITY_DOCUMENT_SEEN',
  'GUARDIAN_REPORTED',
] as const;

export const createReferralRequestSchema = z
  .strictObject({
    clientOperationId: z.uuid(),
    childId: z.uuid(),
    /** The completed screening the referral comes from (optional for a direct concern). */
    sessionId: z.uuid().optional(),
    category: fourDCategorySchema.optional(),
    /** A suggestion; the approver sets the priority (decision K). */
    suggestedPriority: referralPrioritySchema,
    reasonCode: z.enum([
      'RULE_RECOMMENDATION',
      'WORKER_OBSERVED_CONCERN',
      'GUARDIAN_REPORTED_CONCERN',
      'OTHER',
    ]),
    /** Short, no names or phone numbers. Required for OTHER. Encrypted. */
    reasonNote: noteSchema.optional(),
    facilityId: z.uuid().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.reasonCode === 'OTHER' && !b.reasonNote) {
      ctx.addIssue({ code: 'custom', message: 'Describe the reason', path: ['reasonNote'] });
    }
    if (b.reasonCode === 'RULE_RECOMMENDATION' && (!b.sessionId || !b.category)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A rule recommendation needs the screening and category',
        path: ['sessionId'],
      });
    }
  });
export type CreateReferralRequest = z.infer<typeof createReferralRequestSchema>;

export const approveReferralRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  priority: referralPrioritySchema,
  facilityId: z.uuid().optional(),
  outOfDistrictReason: noteSchema.optional(),
  note: noteSchema.optional(),
});
export type ApproveReferralRequest = z.infer<typeof approveReferralRequestSchema>;

export const referralReasonRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  /** Mandatory. Short, no names or phone numbers. Encrypted. */
  reason: noteSchema,
});
export type ReferralReasonRequest = z.infer<typeof referralReasonRequestSchema>;

export const changeFacilityRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  facilityId: z.uuid(),
  outOfDistrictReason: noteSchema.optional(),
});
export type ChangeFacilityRequest = z.infer<typeof changeFacilityRequestSchema>;

export const issueReferralRequestSchema = z.strictObject({ expectedVersion: expectedVersionSchema });
export type IssueReferralRequest = z.infer<typeof issueReferralRequestSchema>;

export const referralEventSchema = z.object({
  id: z.string(),
  fromStatus: referralStatusSchema.nullable(),
  toStatus: referralStatusSchema,
  changedByName: z.string(),
  actorRoleCode: z.string(),
  changedAt: z.string(),
  source: z.enum(UPDATE_SOURCES),
  verificationStatus: z.enum(['UNVERIFIED', 'VERIFIED']),
  effectiveAt: z.string().nullable(),
  facilityName: z.string().nullable(),
  correctsEventId: z.string().nullable(),
  reason: z.string().nullable(),
  note: z.string().nullable(),
});
export type ReferralEvent = z.infer<typeof referralEventSchema>;

export const referralSummarySchema = z.object({
  id: z.string(),
  childId: z.string(),
  childName: z.string(),
  sessionId: z.string().nullable(),
  category: fourDCategorySchema.nullable(),
  origin: z.enum(REFERRAL_ORIGINS),
  priority: referralPrioritySchema,
  status: referralStatusSchema,
  version: z.number(),
  facilityId: z.string().nullable(),
  facilityName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Amendments made after this referral that still wait for reassessment (Step 6G, G9). */
  pendingReassessments: z.number(),
});
export type ReferralSummary = z.infer<typeof referralSummarySchema>;

export const referralDetailSchema = referralSummarySchema.extend({
  screeningResultId: z.string().nullable(),
  clinicalReviewId: z.string().nullable(),
  reasonCode: z.string(),
  reasonNote: z.string().nullable(),
  createdByName: z.string(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  issuedAt: z.string().nullable(),
  sharingConsentId: z.string().nullable(),
  consentVerifiedAt: z.string().nullable(),
  /** The REFERRAL_DATA_SHARING consent used at issue was withdrawn afterwards (decision M). */
  consentWithdrawnAfterIssue: z.boolean(),
  outOfDistrictReason: z.string().nullable(),
  appointmentAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  history: z.array(referralEventSchema),
  reassessments: z.array(
    z.object({
      id: z.string(),
      amendmentId: z.string(),
      amendmentSequence: z.number(),
      statusAtAmendment: referralStatusSchema,
      reassessmentStatus: z.enum(['PENDING', 'REASSESSED']),
      reassessedByName: z.string().nullable(),
      reassessedAt: z.string().nullable(),
    }),
  ),
  /** What the caller may do now (decided by the server; the app only shows these). */
  actions: z.object({
    approve: z.boolean(),
    reject: z.boolean(),
    changeFacility: z.boolean(),
    issue: z.boolean(),
    cancel: z.boolean(),
    reassess: z.boolean(),
  }),
});
export type ReferralDetail = z.infer<typeof referralDetailSchema>;

export const referralResponseSchema = z.object({ referral: referralDetailSchema });
export type ReferralResponse = z.infer<typeof referralResponseSchema>;

export const referralListQuerySchema = z.strictObject({
  status: referralStatusSchema.optional(),
  childId: z.uuid().optional(),
  category: fourDCategorySchema.optional(),
  facilityId: z.uuid().optional(),
  /** Only referrals waiting for the caller's approval role. */
  awaitingApproval: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ReferralListQuery = z.infer<typeof referralListQuerySchema>;

export const referralListResponseSchema = z.object({
  items: z.array(referralSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type ReferralListResponse = z.infer<typeof referralListResponseSchema>;
