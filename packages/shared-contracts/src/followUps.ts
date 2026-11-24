import { z } from 'zod';
import { followUpReasonCodeSchema, referralStatusSchema } from './referrals.js';
import { fourDCategorySchema } from './screening.js';

/**
 * Step 7 stage 7D: referral tracking after issue, follow-ups, in-app notifications and dashboards
 * (decisions O, Q, R, S, T). Sources and verification of tracking updates are decided by the
 * server from the source; nothing here is a confirmed hospital record unless VERIFIED.
 */

const expectedVersionSchema = z.number().int().min(1);
const noteSchema = z.string().trim().min(3).max(1000);
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ================================================================ referral tracking

export const TRACKING_STATUSES = [
  'ACKNOWLEDGED',
  'APPOINTMENT_SCHEDULED',
  'VISITED',
  'VISIT_NOT_COMPLETED',
  'UNDER_TREATMENT',
  'FOLLOW_UP_REQUIRED',
] as const;

/**
 * Who told us (decision O). FACILITY_* = information from the facility itself (recorded as
 * VERIFIED); GUARDIAN_REPORTED = the family's account (recorded as UNVERIFIED, shown as
 * "reported, not verified"). No facility staff accounts exist yet.
 */
export const TRACKING_SOURCES = [
  'FACILITY_PHONE_CALL',
  'FACILITY_DOCUMENT_SEEN',
  'GUARDIAN_REPORTED',
] as const;

export const referralTrackingRequestSchema = z
  .strictObject({
    expectedVersion: expectedVersionSchema,
    toStatus: z.enum(TRACKING_STATUSES),
    source: z.enum(TRACKING_SOURCES),
    /** When it happened according to the source (not when it is entered). Not in the future. */
    effectiveAt: z.iso.datetime({ offset: true }).optional(),
    /** Required for APPOINTMENT_SCHEDULED. */
    appointmentAt: z.iso.datetime({ offset: true }).optional(),
    note: noteSchema.optional(),
  })
  .superRefine((b, ctx) => {
    if ((b.toStatus === 'APPOINTMENT_SCHEDULED') !== (b.appointmentAt !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'An appointment time is given exactly with APPOINTMENT_SCHEDULED',
        path: ['appointmentAt'],
      });
    }
  });
export type ReferralTrackingRequest = z.infer<typeof referralTrackingRequestSchema>;

export const referralCloseRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  reason: noteSchema,
});
export type ReferralCloseRequest = z.infer<typeof referralCloseRequestSchema>;

/** Reverts the latest tracking update entered by mistake (decision J). */
export const referralCorrectionRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  /** The event being corrected - must be the latest one. */
  eventId: z.uuid(),
  reason: noteSchema,
});
export type ReferralCorrectionRequest = z.infer<typeof referralCorrectionRequestSchema>;

// ================================================================ follow-ups

export const FOLLOW_UP_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'MISSED',
  'CANCELLED',
] as const;
export const followUpStatusSchema = z.enum(FOLLOW_UP_STATUSES);

export const createFollowUpRequestSchema = z.strictObject({
  clientOperationId: z.uuid(),
  childId: z.uuid(),
  referralId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  reasonCode: followUpReasonCodeSchema,
  reasonNote: noteSchema.optional(),
  dueDate: calendarDateSchema,
  /** Supervisors / medical officers only; a field worker's own task is assigned to them. */
  assignToUserId: z.uuid().optional(),
  nextAction: noteSchema.optional(),
});
export type CreateFollowUpRequest = z.infer<typeof createFollowUpRequestSchema>;

export const assignFollowUpRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  assignToUserId: z.uuid(),
  /** Required when the task already had an assignee. */
  reason: noteSchema.optional(),
});
export type AssignFollowUpRequest = z.infer<typeof assignFollowUpRequestSchema>;

export const followUpVersionRequestSchema = z.strictObject({ expectedVersion: expectedVersionSchema });
export type FollowUpVersionRequest = z.infer<typeof followUpVersionRequestSchema>;

export const completeFollowUpRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  outcomeNote: noteSchema,
  nextAction: noteSchema.optional(),
});
export type CompleteFollowUpRequest = z.infer<typeof completeFollowUpRequestSchema>;

export const rescheduleFollowUpRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  dueDate: calendarDateSchema,
  reason: noteSchema,
});
export type RescheduleFollowUpRequest = z.infer<typeof rescheduleFollowUpRequestSchema>;

export const followUpReasonRequestSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  reason: noteSchema,
});
export type FollowUpReasonRequest = z.infer<typeof followUpReasonRequestSchema>;

export const followUpSummarySchema = z.object({
  id: z.string(),
  childId: z.string(),
  childName: z.string(),
  referralId: z.string().nullable(),
  sessionId: z.string().nullable(),
  clinicalReviewId: z.string().nullable(),
  reasonCode: z.string(),
  dueDate: z.string(),
  status: followUpStatusSchema,
  /** Computed: due date passed and still open. MISSED is a separate, human decision. */
  overdue: z.boolean(),
  assignedToId: z.string().nullable(),
  assignedToName: z.string().nullable(),
  assignedToMe: z.boolean(),
  version: z.number(),
  updatedAt: z.string(),
});
export type FollowUpSummary = z.infer<typeof followUpSummarySchema>;

export const followUpDetailSchema = followUpSummarySchema.extend({
  reasonNote: z.string().nullable(),
  nextAction: z.string().nullable(),
  outcomeNote: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedByName: z.string().nullable(),
  createdByName: z.string(),
  history: z.array(
    z.object({
      type: z.enum([
        'CREATED',
        'ASSIGNED',
        'REASSIGNED',
        'STARTED',
        'RESCHEDULED',
        'COMPLETED',
        'MISSED',
        'CANCELLED',
      ]),
      fromStatus: followUpStatusSchema.nullable(),
      toStatus: followUpStatusSchema,
      actorName: z.string(),
      assignedToName: z.string().nullable(),
      oldDueDate: z.string().nullable(),
      newDueDate: z.string().nullable(),
      reason: z.string().nullable(),
      occurredAt: z.string(),
    }),
  ),
  actions: z.object({
    assign: z.boolean(),
    start: z.boolean(),
    complete: z.boolean(),
    reschedule: z.boolean(),
    miss: z.boolean(),
    cancel: z.boolean(),
  }),
});
export type FollowUpDetail = z.infer<typeof followUpDetailSchema>;

export const followUpResponseSchema = z.object({ followUp: followUpDetailSchema });
export type FollowUpResponse = z.infer<typeof followUpResponseSchema>;

export const followUpListQuerySchema = z.strictObject({
  /** mine = assigned to me (default for field workers' task list). */
  assigned: z.enum(['mine', 'any', 'unassigned']).optional(),
  status: followUpStatusSchema.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  childId: z.uuid().optional(),
  referralId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type FollowUpListQuery = z.infer<typeof followUpListQuerySchema>;

export const followUpListResponseSchema = z.object({
  items: z.array(followUpSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type FollowUpListResponse = z.infer<typeof followUpListResponseSchema>;

// ================================================================ notifications

export const NOTIFICATION_TYPES = [
  'REVIEW_TASK_NEW',
  'REVIEW_OVERDUE',
  'ADDITIONAL_ASSESSMENT_REQUESTED',
  'REFERRAL_APPROVED',
  'REFERRAL_REJECTED',
  'REFERRAL_ISSUED',
  'REFERRAL_ACKNOWLEDGED',
  'REFERRAL_APPOINTMENT_SCHEDULED',
  'REFERRAL_STATUS_CHANGED',
  'FOLLOW_UP_ASSIGNED',
  'FOLLOW_UP_DUE_SOON',
  'FOLLOW_UP_OVERDUE',
  'SYSTEM',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/** IDs and type only. The app shows generic, translated text per type - never names or health details. */
export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  entityType: z.enum(['clinicalReview', 'referral', 'followUp', 'system']),
  entityId: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type AppNotification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = z.strictObject({
  unreadOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number(),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

// ================================================================ dashboards and reports

/**
 * Counts over records the caller may already read (child.read scope). Definitions:
 * docs/step-7/api-documentation.md "Metric definitions". Issued, acknowledged, visited and closed
 * are separate counts - never added together.
 */
export const referralDashboardSchema = z.object({
  referrals: z.object({
    total: z.number(),
    byStatus: z.record(referralStatusSchema, z.number()),
    pendingApproval: z.number(),
    issued: z.number(),
    acknowledged: z.number(),
    visitRecorded: z.number(),
    closed: z.number(),
    awaitingReassessment: z.number(),
  }),
  followUps: z.object({
    open: z.number(),
    overdue: z.number(),
    missed: z.number(),
    assignedToMe: z.number(),
  }),
  /** Only for screening.review holders; null otherwise. */
  reviewsOpen: z.number().nullable(),
});
export type ReferralDashboard = z.infer<typeof referralDashboardSchema>;

export const resultDashboardSchema = z.object({
  completedScreenings: z.number(),
  awaitingReview: z.number(),
  furtherEvaluation: z.number(),
  urgentEvaluation: z.number(),
  incompleteOrUndetermined: z.number(),
  notInterpreted: z.number(),
  /** True while any counted result used unapproved (demonstration / draft) content. */
  includesUnapprovedContent: z.boolean(),
});
export type ResultDashboard = z.infer<typeof resultDashboardSchema>;

export const aggregateReportQuerySchema = z.strictObject({
  areaId: z.uuid(),
  from: calendarDateSchema,
  to: calendarDateSchema,
});
export type AggregateReportQuery = z.infer<typeof aggregateReportQuerySchema>;

/** A count or, when 1-4 (small-cell suppression, assumption), null with suppressed = true. */
export const suppressedCountSchema = z.object({ value: z.number().nullable(), suppressed: z.boolean() });

export const aggregateReportSchema = z.object({
  areaId: z.string(),
  areaName: z.string(),
  from: z.string(),
  to: z.string(),
  suppressionThreshold: z.number(),
  screeningsCompleted: suppressedCountSchema,
  referralsCreated: suppressedCountSchema,
  referralsIssued: suppressedCountSchema,
  referralsAcknowledged: suppressedCountSchema,
  visitsRecorded: suppressedCountSchema,
  referralsClosed: suppressedCountSchema,
  followUpsOverdue: suppressedCountSchema,
  byCategory: z.array(z.object({ category: fourDCategorySchema, referralsCreated: suppressedCountSchema })),
  /** Sub-areas one level down (e.g. blocks of a district). */
  bySubArea: z.array(
    z.object({
      areaId: z.string(),
      areaName: z.string(),
      referralsCreated: suppressedCountSchema,
      referralsIssued: suppressedCountSchema,
    }),
  ),
});
export type AggregateReport = z.infer<typeof aggregateReportSchema>;
