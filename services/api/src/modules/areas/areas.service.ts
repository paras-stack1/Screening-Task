import {
  AREA_CHILDREN_LIMIT,
  AREA_SEARCH_LIMIT,
  type AreaListQuery,
  type AreaListResponse,
  type AreaNode,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { areaScopeWhere } from '../access-control/accessScope';

/**
 * Area tree browsing for administrators (admin portal stage PA, GET /api/v1/areas).
 *
 * Returns reference data only (area names, codes, levels) - no people, no child data - limited
 * to the areas where the caller holds user.manage or assignment.manage, so an administrator can
 * pick exactly the areas they are allowed to assign. The assignment and user services check
 * delegation again on every change; this endpoint never grants anything.
 */
export interface AreaContext {
  userId: string;
  at: Date;
}

/** Active areas (of an active level) the caller administers. */
export function adminAreaWhere(userId: string, at: Date): Prisma.AreaWhereInput {
  return {
    AND: [
      { isActive: true, level: { isActive: true } },
      {
        OR: [areaScopeWhere(userId, 'user.manage', at), areaScopeWhere(userId, 'assignment.manage', at)],
      },
    ],
  };
}

function nodeSelect(visible: Prisma.AreaWhereInput) {
  return {
    id: true,
    code: true,
    nameEn: true,
    nameHi: true,
    level: { select: { code: true, nameEn: true, nameHi: true, allowsChildRegistration: true } },
    _count: { select: { subAreas: { where: visible } } },
    ancestorLinks: {
      where: { depth: { gt: 0 } },
      orderBy: { depth: 'desc' },
      select: {
        ancestor: { select: { id: true, nameEn: true, nameHi: true, level: { select: { code: true } } } },
      },
    },
  } satisfies Prisma.AreaSelect;
}

type NodeRow = Prisma.AreaGetPayload<{ select: ReturnType<typeof nodeSelect> }>;

function toNode(row: NodeRow): AreaNode {
  return {
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameHi: row.nameHi,
    levelCode: row.level.code,
    levelNameEn: row.level.nameEn,
    levelNameHi: row.level.nameHi,
    allowsChildRegistration: row.level.allowsChildRegistration,
    childCount: row._count.subAreas,
    path: row.ancestorLinks.map(({ ancestor }) => ({
      id: ancestor.id,
      nameEn: ancestor.nameEn,
      nameHi: ancestor.nameHi,
      levelCode: ancestor.level.code,
    })),
  };
}

export function createAreasService(db: PrismaClient) {
  async function list(where: Prisma.AreaWhereInput, visible: Prisma.AreaWhereInput, limit: number) {
    const rows = await db.area.findMany({
      where,
      select: nodeSelect(visible),
      orderBy: [{ nameEn: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return { items: rows.slice(0, limit).map(toNode), truncated: rows.length > limit };
  }

  return {
    async list(ctx: AreaContext, query: AreaListQuery): Promise<AreaListResponse> {
      const visible = adminAreaWhere(ctx.userId, ctx.at);

      if (query.search) {
        const term = query.search;
        return list(
          {
            AND: [
              visible,
              {
                OR: [
                  { nameEn: { contains: term, mode: 'insensitive' } },
                  { nameHi: { contains: term.normalize('NFC'), mode: 'insensitive' } },
                  { code: { contains: term, mode: 'insensitive' } },
                ],
              },
            ],
          },
          visible,
          AREA_SEARCH_LIMIT,
        );
      }

      if (query.parentId) {
        // An area outside the caller's scope looks exactly like one that does not exist.
        const parentVisible = await db.area.count({ where: { AND: [{ id: query.parentId }, visible] } });
        if (parentVisible === 0) throw AppError.notFound('Area not found');
        return list({ AND: [{ parentId: query.parentId }, visible] }, visible, AREA_CHILDREN_LIMIT);
      }

      // Top areas: administered, and the parent is not (or there is no parent).
      return list(
        { AND: [visible, { OR: [{ parentId: null }, { parent: { isNot: visible } }] }] },
        visible,
        AREA_CHILDREN_LIMIT,
      );
    },
  };
}
