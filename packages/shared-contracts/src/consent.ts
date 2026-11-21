import { z } from 'zod';
import { preferredLanguageSchema, shortReasonSchema } from './people.js';

/**
 * Purpose-specific, versioned, append-only consent (Step 5; docs/api/consent.md).
 *
 * - One record = one decision by one guardian for ONE purpose, against the exact notice version
 *   shown. Purposes are never bundled: screening consent does not cover photos, photos do not
 *   cover video, and none of them covers AI processing.
 * - Records are never edited or deleted. A withdrawal is stamped on the granted record once.
 * - Missing, refused, withdrawn or no-longer-valid consent is NEVER permission. The API decides;
 *   the app only displays the API's answer.
 */
export const CONSENT_PURPOSES = [
  'SCREENING',
  'PHOTO_CAPTURE',
  'VIDEO_CAPTURE',
  'AUDIO_CAPTURE',
  'AI_PROCESSING',
  'REFERRAL_DATA_SHARING',
  'SMS_REMINDERS',
] as const;
export const consentPurposeSchema = z.enum(CONSENT_PURPOSES);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

export const CONSENT_DECISIONS = ['GRANTED', 'REFUSED'] as const;
export const consentDecisionSchema = z.enum(CONSENT_DECISIONS);

/** Illustrative methods (decision D7 open - legal review required). */
export const CONSENT_METHODS = [
  'VERBAL_WITNESSED',
  'SIGNATURE',
  'THUMB_IMPRESSION',
  'DIGITAL_ACKNOWLEDGEMENT',
] as const;
export const consentMethodSchema = z.enum(CONSENT_METHODS);
export type ConsentMethod = z.infer<typeof consentMethodSchema>;

/**
 * Display state per purpose (decisions K and M):
 *  NOT_RECORDED - no decision recorded;   GRANTED - the only state that permits the activity;
 *  REFUSED;  WITHDRAWN;
 *  NOT_VALID - a grant that no longer counts (see `reason`), e.g. the guardian's link ended.
 */
export const CONSENT_STATUSES = ['NOT_RECORDED', 'GRANTED', 'REFUSED', 'WITHDRAWN', 'NOT_VALID'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_INVALID_REASONS = [
  'GUARDIAN_NO_LONGER_LINKED',
  'GUARDIAN_NOT_AUTHORISED',
  'NOTICE_RETIRED',
  'NOTICE_NOT_APPROVED',
] as const;
export type ConsentInvalidReason = (typeof CONSENT_INVALID_REASONS)[number];

// ------------------------------------------------------------------------ notices

export const consentNoticeQuerySchema = z.strictObject({
  language: preferredLanguageSchema,
  purpose: consentPurposeSchema.optional(),
});
export type ConsentNoticeQuery = z.infer<typeof consentNoticeQuerySchema>;

export const consentNoticeSchema = z.object({
  /** Send this back when recording: binds the decision to the exact wording shown. */
  templateId: z.string(),
  purpose: z.string(),
  version: z.number(),
  language: z.string(),
  title: z.string(),
  body: z.string(),
  /** False only for programme participation (screening); everything else is optional. */
  optional: z.boolean(),
  /** True while the wording is a placeholder awaiting legal/programme approval. */
  isPlaceholder: z.boolean(),
  approvalStatus: z.string(),
});
export type ConsentNotice = z.infer<typeof consentNoticeSchema>;

export const consentNoticesResponseSchema = z.object({ items: z.array(consentNoticeSchema) });
export type ConsentNoticesResponse = z.infer<typeof consentNoticesResponseSchema>;

// ------------------------------------------------------------------------ requests

export const recordConsentRequestSchema = z.strictObject({
  clientOperationId: z.uuid(),
  /** The guardian giving the decision; must be currently linked with consent authority. */
  guardianId: z.uuid(),
  purpose: consentPurposeSchema,
  decision: consentDecisionSchema,
  method: consentMethodSchema,
  /** The notice shown (from GET /consent-notices). Must be the current version. */
  templateId: z.uuid(),
  /** Paper form number or similar. Must not contain personal data. */
  evidenceReference: z.string().trim().min(1).max(64).optional(),
});
export type RecordConsentRequest = z.infer<typeof recordConsentRequestSchema>;

export const withdrawConsentRequestSchema = z.strictObject({
  /** The guardian asking to withdraw; must be currently linked with consent authority. */
  guardianId: z.uuid(),
  method: consentMethodSchema,
  /** Optional, short, no personal data. */
  reason: shortReasonSchema.optional(),
});
export type WithdrawConsentRequest = z.infer<typeof withdrawConsentRequestSchema>;

// ------------------------------------------------------------------------ responses

export const consentRecordSchema = z.object({
  id: z.string(),
  purpose: z.string(),
  decision: z.string(),
  method: z.string(),
  noticeVersion: z.number(),
  noticeLanguage: z.string(),
  noticeWasPlaceholder: z.boolean(),
  evidenceReference: z.string().nullable(),
  guardianId: z.string(),
  guardianName: z.string(),
  recordedAt: z.string(),
  recordedByName: z.string(),
  withdrawnAt: z.string().nullable(),
  withdrawnByName: z.string().nullable(),
  withdrawalMethod: z.string().nullable(),
  withdrawalReason: z.string().nullable(),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const consentPurposeStatusSchema = z.object({
  purpose: z.string(),
  status: z.enum(CONSENT_STATUSES),
  reason: z.enum(CONSENT_INVALID_REASONS).nullable(),
  /** True only when status is GRANTED. */
  permitted: z.boolean(),
  /** The record the status is based on (null when NOT_RECORDED). */
  consentId: z.string().nullable(),
  guardianName: z.string().nullable(),
  recordedAt: z.string().nullable(),
});
export type ConsentPurposeStatus = z.infer<typeof consentPurposeStatusSchema>;

/** GET /children/:childId/consents - current status for every purpose + full history. */
export const childConsentsResponseSchema = z.object({
  statuses: z.array(consentPurposeStatusSchema),
  history: z.array(consentRecordSchema),
});
export type ChildConsentsResponse = z.infer<typeof childConsentsResponseSchema>;

export const consentRecordResponseSchema = z.object({
  consent: consentRecordSchema,
  status: consentPurposeStatusSchema,
});
export type ConsentRecordResponse = z.infer<typeof consentRecordResponseSchema>;
