import { z } from 'zod';

/**
 * Area tree browsing for administration (admin portal, stage PA). Reference data only: area
 * names and levels, never people or child data. Scoped to the areas where the caller holds
 * user.manage or assignment.manage.
 *
 * Three mutually exclusive modes:
 *  - no parameters: the caller's top areas (in scope, parent not in scope);
 *  - `parentId`: the in-scope sub-areas of one in-scope area;
 *  - `search`: in-scope areas whose name or code matches, with their path for display.
 */
export const AREA_SEARCH_LIMIT = 50;
export const AREA_CHILDREN_LIMIT = 500;

export const areaListQuerySchema = z
  .strictObject({
    parentId: z.uuid().optional(),
    search: z.string().trim().min(2).max(50).optional(),
  })
  .refine((query) => !(query.parentId && query.search), {
    message: 'Use either parentId or search, not both',
    path: ['search'],
  });
export type AreaListQuery = z.infer<typeof areaListQuerySchema>;

export const areaPathItemSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameHi: z.string().nullable(),
  levelCode: z.string(),
});
export type AreaPathItem = z.infer<typeof areaPathItemSchema>;

export const areaNodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameEn: z.string(),
  nameHi: z.string().nullable(),
  levelCode: z.string(),
  levelNameEn: z.string(),
  levelNameHi: z.string(),
  /** Children (and therefore field workers) can be registered at this level. */
  allowsChildRegistration: z.boolean(),
  /** Active sub-areas the caller can also see (0 = leaf for this caller). */
  childCount: z.number().int().nonnegative(),
  /** Ancestors from the top of the tree down to the parent (empty for the root). */
  path: z.array(areaPathItemSchema),
});
export type AreaNode = z.infer<typeof areaNodeSchema>;

export const areaListResponseSchema = z.object({
  items: z.array(areaNodeSchema),
  /** True when more areas matched than were returned; narrow the search. */
  truncated: z.boolean(),
});
export type AreaListResponse = z.infer<typeof areaListResponseSchema>;
