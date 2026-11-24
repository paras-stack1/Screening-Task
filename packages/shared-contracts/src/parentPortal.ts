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
