import { z } from 'zod';

/**
 * Parent Portal onboarding (Step 8; docs/step-8/parent-portal-plan.md, decisions PP1-PP18).
 * Worker side: invite a guardian and confirm which children they may see. The invitation token
 * is never part of any API response; phone numbers are shown masked only.
 */

export const PARENT_INVITATION_STATUSES = [
  'NOT_INVITED',
  'INVITATION_PENDING',
  'INVITATION_SENT',
  'ACTIVATED',
  'EXPIRED',
  'REVOKED',
] as const;
export const parentInvitationStatusSchema = z.enum(PARENT_INVITATION_STATUSES);
export type ParentInvitationStatus = z.infer<typeof parentInvitationStatusSchema>;

export const createParentInvitationRequestSchema = z.strictObject({
  /** The worker confirms the guardian asked for / agreed to receive the invitation. */
  guardianAgreed: z.literal(true),
  /** The children this guardian may see in the portal (each must be an active link). */
  childIds: z.array(z.uuid()).min(1).max(20),
});
export type CreateParentInvitationRequest = z.infer<typeof createParentInvitationRequestSchema>;

export const revokeParentInvitationRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(300),
});
export type RevokeParentInvitationRequest = z.infer<typeof revokeParentInvitationRequestSchema>;

export const parentPortalStatusSchema = z.object({
  guardianId: z.string(),
  guardianName: z.string(),
  status: parentInvitationStatusSchema,
  /** e.g. "******3210"; null when no phone is recorded. */
  maskedPhone: z.string().nullable(),
  latestInvitation: z
    .object({
      id: z.string(),
      createdAt: z.string(),
      expiresAt: z.string(),
      sentAt: z.string().nullable(),
      createdByName: z.string(),
      /** Delivery of the invitation SMS: SENT, FAILED, NOT_CONFIGURED (no SMS provider), QUEUED. */
      smsStatus: z.enum(['QUEUED', 'SENT', 'FAILED', 'NOT_CONFIGURED']).nullable(),
      revokedReason: z.string().nullable(),
    })
    .nullable(),
  /** Children of this guardian in the caller's areas, with portal access state. */
  children: z.array(
    z.object({
      childId: z.string(),
      childName: z.string(),
      relationship: z.string(),
      access: z.enum(['NONE', 'PENDING', 'ACTIVE', 'REVOKED']),
    }),
  ),
  /** Decided by the API: guardian.invite over at least one linked child, phone present, no active account. */
  canInvite: z.boolean(),
  /** Why an invitation is not possible right now (for the screen). */
  blockedReason: z.enum(['NO_PHONE', 'ALREADY_ACTIVATED', 'NOT_ALLOWED']).nullable(),
});
export type ParentPortalStatus = z.infer<typeof parentPortalStatusSchema>;

export const parentPortalStatusResponseSchema = z.object({ portal: parentPortalStatusSchema });
export type ParentPortalStatusResponse = z.infer<typeof parentPortalStatusResponseSchema>;

// ------------------------------------------------------------------ parent onboarding (stage 4)
// Public endpoints keyed by the invitation token (from the link fragment). Responses never
// contain the guardian's or children's names, health information, the code or the token.

/** 32 random bytes, base64url (43 characters). */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invitation');

export const invitationTokenRequestSchema = z.strictObject({ token: invitationTokenSchema });
export type InvitationTokenRequest = z.infer<typeof invitationTokenRequestSchema>;

export const invitationValidationResponseSchema = z.object({
  valid: z.literal(true),
  /** e.g. "********3210" - so the parent can recognise their number. */
  maskedPhone: z.string(),
  expiresAt: z.string(),
  /** True once the mobile number was verified with a code (activation may follow). */
  phoneVerified: z.boolean(),
});
export type InvitationValidationResponse = z.infer<typeof invitationValidationResponseSchema>;

export const sendOtpResponseSchema = z.object({
  sent: z.literal(true),
  maskedPhone: z.string(),
  expiresAt: z.string(),
  /** Earliest time another code may be requested. */
  resendAfter: z.string(),
});
export type SendOtpResponse = z.infer<typeof sendOtpResponseSchema>;

export const verifyOtpRequestSchema = z.strictObject({
  token: invitationTokenSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;

export const verifyOtpResponseSchema = z.object({
  verified: z.literal(true),
  /** Short-lived proof of the verification, required by /parent/activate. Keep in memory only. */
  activationTicket: z.string(),
  ticketExpiresAt: z.string(),
});
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;

export const parentLegalDocumentSchema = z.object({
  kind: z.enum(['PRIVACY_NOTICE', 'TERMS']),
  version: z.string(),
  language: z.enum(['hi', 'en']),
  title: z.string(),
  text: z.string(),
  /** True while the wording is a placeholder awaiting legal/programme approval. */
  isPlaceholder: z.boolean(),
});
export type ParentLegalDocument = z.infer<typeof parentLegalDocumentSchema>;

export const parentLegalResponseSchema = z.object({
  privacyNotice: parentLegalDocumentSchema,
  terms: parentLegalDocumentSchema,
});
export type ParentLegalResponse = z.infer<typeof parentLegalResponseSchema>;

export const activateParentAccountRequestSchema = z
  .strictObject({
    token: invitationTokenSchema,
    activationTicket: z.string().min(1).max(400),
    password: z.string().min(1).max(256),
    confirmPassword: z.string().min(1).max(256),
    /** The versions the parent read and accepted (must be the current ones). */
    privacyNoticeVersion: z.string().min(1).max(40),
    termsVersion: z.string().min(1).max(40),
    acceptPrivacyNotice: z.literal(true),
    acceptTerms: z.literal(true),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type ActivateParentAccountRequest = z.infer<typeof activateParentAccountRequestSchema>;

export const activateParentAccountResponseSchema = z.object({
  activated: z.literal(true),
  /** The parent signs in next with their mobile number and the new password (stage 5). */
  maskedPhone: z.string(),
});
export type ActivateParentAccountResponse = z.infer<typeof activateParentAccountResponseSchema>;
