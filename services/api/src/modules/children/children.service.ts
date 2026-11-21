import type {
  ChildDetailResponse,
  ChildListQuery,
  ChildListResponse,
  ChildSummary,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import { recordAudit } from '../audit/audit.service';
import { childScopeWhere, findChildOrDeny, type AccessContext } from '../access-control/accessScope';

const SORTS: Record<ChildListQuery['sort'], Prisma.ChildOrderByWithRelationInput> = {
  fullName: { fullName: 'asc' },
  '-fullName': { fullName: 'desc' },
  dateOfBirth: { dateOfBirth: 'asc' },
  '-dateOfBirth': { dateOfBirth: 'desc' },
  createdAt: { createdAt: 'asc' },
  '-createdAt': { createdAt: 'desc' },
};

const summarySelect = {
  id: true,
  fullName: true,
  dateOfBirth: true,
  dobIsEstimated: true,
  sexAtBirth: true,
  areaId: true,
  area: { select: { nameEn: true } },
} satisfies Prisma.ChildSelect;

function toSummary(row: Prisma.ChildGetPayload<{ select: typeof summarySelect }>): ChildSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
    dobIsEstimated: row.dobIsEstimated,
    sexAtBirth: row.sexAtBirth,
    areaId: row.areaId,
    areaName: row.area.nameEn,
  };
}

export function createChildrenService(db: PrismaClient) {
  return {
    /**
     * The scope filter is applied in the database query, so pagination, the total count,
     * search and sorting only ever see in-scope children. Caller filters (search, areaId) are
     * ANDed with the scope and can only narrow it.
     */
    async list(ctx: AccessContext, query: ChildListQuery): Promise<ChildListResponse> {
      const where: Prisma.ChildWhereInput = {
        AND: [
          childScopeWhere(ctx.userId, 'child.read', ctx.at),
          query.search ? { fullName: { contains: query.search, mode: 'insensitive' } } : {},
          query.areaId ? { area: { ancestorLinks: { some: { ancestorId: query.areaId } } } } : {},
        ],
      };
      const [rows, total] = await Promise.all([
        db.child.findMany({
          where,
          select: summarySelect,
          // `id` as tie-breaker keeps pages stable.
          orderBy: [SORTS[query.sort], { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.child.count({ where }),
      ]);
      return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
    },

    /** Profile with current guardians. Out of scope or unknown -> 404 (audited). Views are audited. */
    async get(ctx: AccessContext, childId: string): Promise<ChildDetailResponse> {
      await findChildOrDeny(db, ctx, childId, 'child.read');
      const row = await db.child.findUniqueOrThrow({
        where: { id: childId },
        select: {
          ...summarySelect,
          guardians: {
            where: { endedAt: null, guardian: { deletedAt: null } },
            select: {
              relationship: true,
              isPrimaryContact: true,
              canGiveConsent: true,
              // Phone numbers are never returned here (encrypted at rest; separate, audited access later).
              guardian: { select: { id: true, fullName: true } },
            },
          },
        },
      });
      await recordAudit(db, {
        actorUserId: ctx.userId,
        action: 'child.viewed',
        entityType: 'child',
        entityId: childId,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
      });
      return {
        child: {
          ...toSummary(row),
          guardians: row.guardians.map((link) => ({
            id: link.guardian.id,
            fullName: link.guardian.fullName,
            relationship: link.relationship,
            isPrimaryContact: link.isPrimaryContact,
            canGiveConsent: link.canGiveConsent,
          })),
        },
      };
    },
  };
}
