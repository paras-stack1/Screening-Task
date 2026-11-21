import { z } from 'zod';
import {
  exactlyOneGuardianSource,
  guardianLinkBaseSchema,
  guardianLinkSchema,
  guardianRelationshipSchema,
} from './children.js';
import {
  expectedUpdatedAtSchema,
  indianMobileSchema,
  personNameSchema,
  preferredLanguageSchema,
  shortReasonSchema,
} from './people.js';

/**
 * Guardian and child-guardian link contracts (Step 5; docs/api/children.md).
 * Guardians are only created together with a child (decision E): there is no standalone
 * "create guardian" request.
 */

/** POST /children/:childId/guardians */
export const addGuardianLinkRequestSchema = guardianLinkBaseSchema
  .extend({ clientOperationId: z.uuid() })
  .refine(...exactlyOneGuardianSource);
export type AddGuardianLinkRequest = z.input<typeof addGuardianLinkRequestSchema>;

/** PATCH /children/:childId/guardians/:relationshipId */
export const updateGuardianLinkRequestSchema = z
  .strictObject({
    relationship: guardianRelationshipSchema.optional(),
    isPrimaryContact: z.boolean().optional(),
    canGiveConsent: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), { message: 'Nothing to update' });
export type UpdateGuardianLinkRequest = z.infer<typeof updateGuardianLinkRequestSchema>;

/** DELETE /children/:childId/guardians/:relationshipId - ends the link; history is kept. */
export const endGuardianLinkRequestSchema = z.strictObject({ reason: shortReasonSchema });
export type EndGuardianLinkRequest = z.infer<typeof endGuardianLinkRequestSchema>;

export const guardianLinkListQuerySchema = z.strictObject({
  includeEnded: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type GuardianLinkListQuery = z.infer<typeof guardianLinkListQuerySchema>;

export const guardianLinkListResponseSchema = z.object({ items: z.array(guardianLinkSchema) });
export type GuardianLinkListResponse = z.infer<typeof guardianLinkListResponseSchema>;

export const guardianLinkResponseSchema = z.object({ link: guardianLinkSchema });
export type GuardianLinkResponse = z.infer<typeof guardianLinkResponseSchema>;

/** PATCH /guardians/:guardianId */
export const updateGuardianRequestSchema = z
  .strictObject({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    fullName: personNameSchema.optional(),
    /** null removes the number. */
    phone: indianMobileSchema.nullable().optional(),
    preferredLanguage: preferredLanguageSchema.optional(),
  })
  .refine((v) => v.fullName !== undefined || v.phone !== undefined || v.preferredLanguage !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateGuardianRequest = z.input<typeof updateGuardianRequestSchema>;

/**
 * GET /guardians/:guardianId. The full phone number appears only here (the view is audited).
 * `children` lists ONLY the linked children the caller may access - other children of the same
 * household are never revealed, not even as a count.
 */
export const guardianDetailSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  preferredLanguage: z.string(),
  updatedAt: z.string(),
  children: z.array(
    z.object({
      childId: z.string(),
      childName: z.string(),
      relationshipId: z.string(),
      relationship: z.string(),
      isPrimaryContact: z.boolean(),
      canGiveConsent: z.boolean(),
    }),
  ),
});
export type GuardianDetail = z.infer<typeof guardianDetailSchema>;

export const guardianDetailResponseSchema = z.object({ guardian: guardianDetailSchema });
export type GuardianDetailResponse = z.infer<typeof guardianDetailResponseSchema>;
