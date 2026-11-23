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

export type UserDetailResponse = z.infer<typeof userDetailResponseSchema>;

/**
 * A row of GET /users (admin portal stage PC): the account plus its CURRENT (not revoked, not
 * ended) assignments that lie inside the caller's user.manage areas - assignments elsewhere are
 * not revealed.
 */
export const userListItemSchema = userViewSchema.extend({
  currentAssignments: z.array(
    z.object({
      roleCode: z.string(),
      areaName: z.string(),
      areaNameHi: z.string().nullable(),
      status: z.enum(['ACTIVE', 'SUSPENDED']),
    }),
  ),
});
export type UserListItem = z.infer<typeof userListItemSchema>;

export const userListResponseSchema = z.object({
  items: z.array(userListItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const roleViewSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameEn: z.string(),
  nameHi: z.string(),
  permissions: z.array(z.string()),
});
export type RoleView = z.infer<typeof roleViewSchema>;
export const roleListResponseSchema = z.object({ roles: z.array(roleViewSchema) });
export type RoleListResponse = z.infer<typeof roleListResponseSchema>;

/**
 * Permissions that are MANAGEMENT powers: an administrator may only grant a role whose management
 * permissions they hold themselves over that area (the API decides; the portal uses this list
 * only to hide roles that would certainly be refused). Fieldwork permissions can be granted
 * without being held (decision D11).
 */
export const MANAGEMENT_PERMISSIONS = [
  'report.aggregate',
  'assignment.manage',
  'user.manage',
  'area.manage',
  'facility.manage',
  'audit.read',
] as const;

/** Shown ONCE to the administrator, who passes it to the worker in person. Never stored. */
export const temporaryPasswordResponseSchema = z.object({
  user: userViewSchema,
  temporaryPassword: z.string(),
});
export type TemporaryPasswordResponse = z.infer<typeof temporaryPasswordResponseSchema>;

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
