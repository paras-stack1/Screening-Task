import { z } from 'zod';
import { indianMobileSchema } from './people.js';

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

// ---------------------------------------------------- parent sign-in and account (stage 5)
// Separate from staff auth: parent access tokens have their own audience and are rejected by
// every staff route. The role is always PARENT_GUARDIAN and cannot be chosen or changed.

export const PARENT_ROLE = 'PARENT_GUARDIAN' as const;
const parentPasswordInput = z.string().min(1).max(256);

export const parentLoginRequestSchema = z.strictObject({
  phone: indianMobileSchema,
  password: parentPasswordInput,
  /** Optional user-visible label such as "Android phone". No device identifiers. */
  deviceLabel: z.string().trim().min(1).max(60).optional(),
});
export type ParentLoginRequest = z.input<typeof parentLoginRequestSchema>;

export const parentRefreshRequestSchema = z.strictObject({ refreshToken: z.string().min(1).max(200) });
export type ParentRefreshRequest = z.infer<typeof parentRefreshRequestSchema>;

export const parentAccountSchema = z.object({
  id: z.string(),
  role: z.literal(PARENT_ROLE),
  /** Shown after sign-in only. */
  guardianName: z.string(),
  maskedPhone: z.string(),
  activatedAt: z.string(),
  passwordChangedAt: z.string(),
  privacyNoticeVersion: z.string(),
  termsVersion: z.string(),
  /** Number of children currently shared with this parent (details arrive in stage 6). */
  childCount: z.number().int(),
});
export type ParentAccount = z.infer<typeof parentAccountSchema>;

export const parentTokensResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.string(),
  account: parentAccountSchema,
});
export type ParentTokensResponse = z.infer<typeof parentTokensResponseSchema>;

/** Browser variant (/parent/auth/web/*): the refresh token is an httpOnly cookie, never in JSON. */
export const parentWebAuthResponseSchema = parentTokensResponseSchema.omit({ refreshToken: true });
export type ParentWebAuthResponse = z.infer<typeof parentWebAuthResponseSchema>;
export const PARENT_WEB_CLIENT_VALUE = 'parent-portal';

export const parentMeResponseSchema = z.object({ account: parentAccountSchema });
export type ParentMeResponse = z.infer<typeof parentMeResponseSchema>;

const newPasswordFields = {
  newPassword: parentPasswordInput,
  confirmPassword: parentPasswordInput,
};
const passwordsMatch = (v: { newPassword: string; confirmPassword: string }) =>
  v.newPassword === v.confirmPassword;
const mismatch = { path: ['confirmPassword'], message: 'Passwords do not match' };

export const parentChangePasswordRequestSchema = z
  .strictObject({ currentPassword: parentPasswordInput, ...newPasswordFields })
  .refine(passwordsMatch, mismatch);
export type ParentChangePasswordRequest = z.infer<typeof parentChangePasswordRequestSchema>;

/** Forgot password: always the same answer, whether or not an account exists. */
export const parentForgotPasswordRequestSchema = z.strictObject({ phone: indianMobileSchema });
export type ParentForgotPasswordRequest = z.input<typeof parentForgotPasswordRequestSchema>;
export const parentForgotPasswordResponseSchema = z.object({
  accepted: z.literal(true),
  /** "If an account exists for this number, a code has been sent." */
  message: z.string(),
});

export const parentResetPasswordRequestSchema = z
  .strictObject({
    phone: indianMobileSchema,
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    ...newPasswordFields,
  })
  .refine(passwordsMatch, mismatch);
export type ParentResetPasswordRequest = z.input<typeof parentResetPasswordRequestSchema>;

/** Mobile number change (PP14): the code goes to the NEW number; the password confirms it is you. */
export const parentPhoneChangeStartRequestSchema = z.strictObject({
  newPhone: indianMobileSchema,
  currentPassword: parentPasswordInput,
});
export type ParentPhoneChangeStartRequest = z.input<typeof parentPhoneChangeStartRequestSchema>;
export const parentPhoneChangeConfirmRequestSchema = z.strictObject({
  newPhone: indianMobileSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type ParentPhoneChangeConfirmRequest = z.input<typeof parentPhoneChangeConfirmRequestSchema>;

// ------------------------------------------------- children shared with a parent (stage 6, PP12)
// Only what the programme agreed a parent may see: name, age, the centre and worker, and upcoming
// dates. No screening results, risk levels, notes, referral reasons or diagnoses.

export const parentChildSchema = z.object({
  childId: z.string(),
  fullName: z.string(),
  ageYears: z.number().int(),
  ageMonths: z.number().int(),
  dobIsEstimated: z.boolean(),
  /** Anganwadi centre / village of the child (both languages). */
  centre: z.object({ nameEn: z.string(), nameHi: z.string().nullable() }),
  /** The ASHA or Anganwadi worker for the child's area (name only - no phone numbers, PP16). */
  workerName: z.string().nullable(),
  /** Next scheduled health check-up (follow-up due date, YYYY-MM-DD). */
  nextCheckUp: z.string().nullable(),
  /** Next doctor appointment at a facility. */
  nextAppointment: z.object({ at: z.string(), facilityName: z.string().nullable() }).nullable(),
});
export type ParentChild = z.infer<typeof parentChildSchema>;

export const parentChildListResponseSchema = z.object({ children: z.array(parentChildSchema) });
export type ParentChildListResponse = z.infer<typeof parentChildListResponseSchema>;

export const parentChildDetailSchema = parentChildSchema.extend({
  upcomingCheckUps: z.array(z.string()),
  upcomingAppointments: z.array(z.object({ at: z.string(), facilityName: z.string().nullable() })),
});
export type ParentChildDetail = z.infer<typeof parentChildDetailSchema>;
export const parentChildDetailResponseSchema = z.object({ child: parentChildDetailSchema });
export type ParentChildDetailResponse = z.infer<typeof parentChildDetailResponseSchema>;

/** Worker: share more children with an ACTIVATED parent (each must be an active link in the worker's area). */
export const grantChildAccessRequestSchema = z.strictObject({
  childIds: z.array(z.uuid()).min(1).max(20),
});
export type GrantChildAccessRequest = z.infer<typeof grantChildAccessRequestSchema>;

/** Worker: stop sharing one child with the parent. */
export const revokeChildAccessRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(300),
});
export type RevokeChildAccessRequest = z.infer<typeof revokeChildAccessRequestSchema>;
