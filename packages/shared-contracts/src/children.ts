import { z } from 'zod';

/**
 * Child read contracts (Step 3: read-only list and profile, used to prove area-scoped access).
 * Registration and updates arrive in Step 4.
 */
export const CHILD_SORTS = [
  'fullName',
  '-fullName',
  'dateOfBirth',
  '-dateOfBirth',
  'createdAt',
  '-createdAt',
] as const;

/** Strict: unknown query parameters are rejected. Sorting is an allowlist, never a raw column. */
export const childListQuerySchema = z.strictObject({
  search: z.string().trim().min(2).max(50).optional(),
  /** Narrows the list to this area and its sub-areas - always WITHIN the caller's scope. */
  areaId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(CHILD_SORTS).default('fullName'),
});
export type ChildListQuery = z.infer<typeof childListQuerySchema>;

export const childSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
  /** Calendar date, YYYY-MM-DD. */
  dateOfBirth: z.string(),
  dobIsEstimated: z.boolean(),
  sexAtBirth: z.string(),
  areaId: z.string(),
  areaName: z.string(),
});
export type ChildSummary = z.infer<typeof childSummarySchema>;

export const childListResponseSchema = z.object({
  items: z.array(childSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  /** Number of matching children in the caller's scope only. */
  total: z.number(),
});
export type ChildListResponse = z.infer<typeof childListResponseSchema>;

export const childGuardianSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  relationship: z.string(),
  isPrimaryContact: z.boolean(),
  canGiveConsent: z.boolean(),
});

export const childDetailResponseSchema = z.object({
  child: childSummarySchema.extend({ guardians: z.array(childGuardianSchema) }),
});
export type ChildDetailResponse = z.infer<typeof childDetailResponseSchema>;
