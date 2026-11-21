import { z } from 'zod';

/**
 * User-account and area-assignment administration (docs/authorization.md).
 * All request schemas are strict: status, password hashes, creator ids and similar fields can
 * never be supplied by a client.
 */
const reasonSchema = z.string().trim().min(3).max(500);
const isoDateTime = z.iso.datetime({ offset: true });

export const assignmentScopeSchema = z.enum(['AREA_ONLY', 'AREA_AND_DESCENDANTS']);

export const newAssignmentSchema = z.strictObject({
  areaId: z.uuid(),
  roleId: z.uuid(),
  /** Required on purpose: descendant access is never implied (rule R3). */
  scope: assignmentScopeSchema,
  /** Defaults to now. May be in the future, never in the past. */
  effectiveFrom: isoDateTime.optional(),
  effectiveTo: isoDateTime.optional(),
  /** Order number or similar. Must not contain children's personal data. */
  reason: reasonSchema,
});
export type NewAssignment = z.infer<typeof newAssignmentSchema>;

export const createAssignmentRequestSchema = newAssignmentSchema.extend({ userId: z.uuid() });
export type CreateAssignmentRequest = z.infer<typeof createAssignmentRequestSchema>;

export const createUserRequestSchema = z.strictObject({
  loginId: z.string().trim().min(3).max(64),
  displayName: z.string().trim().min(2).max(100),
  preferredLanguage: z.enum(['hi', 'en']).optional(),
  /** Every account is created together with its first assignment (decision G). */
  assignment: newAssignmentSchema,
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const changeUserStatusRequestSchema = z.strictObject({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  reason: reasonSchema,
});
export type ChangeUserStatusRequest = z.infer<typeof changeUserStatusRequestSchema>;

export const reasonRequestSchema = z.strictObject({ reason: reasonSchema });
export type ReasonRequest = z.infer<typeof reasonRequestSchema>;

export const endAssignmentRequestSchema = z.strictObject({
  /** Defaults to now. Can only shorten the assignment. */
  effectiveTo: isoDateTime.optional(),
  reason: reasonSchema,
});
export type EndAssignmentRequest = z.infer<typeof endAssignmentRequestSchema>;

export const userListQuerySchema = z.strictObject({
  search: z.string().trim().min(2).max(64).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const assignmentViewSchema = z.object({
  id: z.string(),
  userId: z.string(),
  areaId: z.string(),
  areaName: z.string(),
  roleId: z.string(),
  roleCode: z.string(),
  scope: assignmentScopeSchema,
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
});
export type AssignmentView = z.infer<typeof assignmentViewSchema>;

export const userViewSchema = z.object({
  id: z.string(),
  loginId: z.string(),
  displayName: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
});
export type UserView = z.infer<typeof userViewSchema>;

export const userDetailResponseSchema = z.object({
  user: userViewSchema,
  assignments: z.array(assignmentViewSchema),
});

/** Shown ONCE to the administrator, who passes it to the worker in person. Never stored. */
export const temporaryPasswordResponseSchema = z.object({
  user: userViewSchema,
  temporaryPassword: z.string(),
});

export const effectiveAccessSchema = z.object({
  permissions: z.array(z.string()),
  assignments: z.array(
    z.object({
      assignmentId: z.string(),
      roleCode: z.string(),
      scope: assignmentScopeSchema,
      areaId: z.string(),
      areaName: z.string(),
      areaNameHi: z.string().nullable(),
      areaLevel: z.string(),
      effectiveTo: z.string().nullable(),
    }),
  ),
});
export type EffectiveAccess = z.infer<typeof effectiveAccessSchema>;
