import type { FacilityListQuery, FacilityListResponse, FacilityOption } from '@balswasthya/shared-contracts';
import type { Facility, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import {
  areaScopeWhere,
  childScopeWhere,
  findChildOrDeny,
  type AccessContext,
} from '../access-control/accessScope';
import { hasPermissionAnywhere } from '../access-control/authorization.service';
import type { PermissionCode } from '../access-control/permissions';
import { facilityPlacement, isSelectable } from '../referrals/referralCommon';

export interface FacilitiesServiceDependencies {
  db: PrismaClient;
}

const REFERRAL_PERMISSIONS: PermissionCode[] = ['referral.create', 'referral.approve', 'referral.update'];

const facilityInclude = {
  area: { select: { ancestorLinks: { select: { depth: true, ancestor: { select: { nameEn: true } } } } } },
} satisfies Prisma.FacilityInclude;
type FacilityRow = Facility & Prisma.FacilityGetPayload<{ include: typeof facilityInclude }>;

function toSummary(f: FacilityRow) {
  return {
    id: f.id,
    name: f.name,
    nameHi: f.nameHi,
    officialCode: f.officialCode,
    type: f.type,
    areaId: f.areaId,
    // Closure depth: larger = further up. Top first.
    areaPath: [...f.area.ancestorLinks].sort((a, b) => b.depth - a.depth).map((l) => l.ancestor.nameEn),
    address: f.address,
    contactPhone: f.contactPhone,
    services: f.services,
    acceptsReferrals: f.acceptsReferrals,
    verificationStatus: f.verificationStatus,
    isActive: f.isActive,
  };
}

/**
 * Facility directory - read side (Step 7 stage 7C, decision P). Contains no child data.
 *  - Selection mode (`childId`): facilities for that child's referral, each with its placement
 *    relative to the child's district and whether it may be chosen (active + verified + accepting).
 *    The caller must hold a referral permission over the child (else 404 + audit).
 *  - Directory mode (no `childId`): facility.manage holders see facilities in their area scope.
 * Writes (create, edit, verify, deactivate) come with the admin portal (stage 7G).
 */
export function createFacilitiesService({ db }: FacilitiesServiceDependencies) {
  const at = (ctx: AccessContext) => ctx.at ?? new Date();

  return {
    async list(ctx: AccessContext, query: FacilityListQuery): Promise<FacilityListResponse> {
      const filters: Prisma.FacilityWhereInput[] = [];
      if (query.type) filters.push({ type: query.type });
      if (query.q) {
        filters.push({
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { officialCode: { contains: query.q, mode: 'insensitive' } },
          ],
        });
      }

      if (query.childId) {
        // The child must be in scope for at least one referral permission (one query, no noise in
        // the audit log); otherwise one audited 404, the same as "does not exist" (R11).
        const child =
          (await db.child.findFirst({
            where: {
              id: query.childId,
              OR: REFERRAL_PERMISSIONS.map((p) => childScopeWhere(ctx.userId, p, at(ctx))),
            },
          })) ?? (await findChildOrDeny(db, ctx, query.childId, 'referral.create'));
        const rows = await db.facility.findMany({
          where: { AND: [{ isActive: true }, ...filters] },
          include: facilityInclude,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: 500,
        });
        const items: FacilityOption[] = [];
        for (const f of rows) {
          const placement = await facilityPlacement(db, child.areaId, f.areaId);
          if (placement === 'OUT_OF_DISTRICT' && query.includeOutOfDistrict !== 'true') continue;
          items.push({ ...toSummary(f), placement, selectable: isSelectable(f) });
        }
        // In-district and selectable first; never "nearest first" (decision P).
        items.sort(
          (a, b) =>
            Number(b.placement === 'IN_DISTRICT') - Number(a.placement === 'IN_DISTRICT') ||
            Number(b.selectable) - Number(a.selectable),
        );
        return { items };
      }

      if (!(await hasPermissionAnywhere(db, ctx.userId, 'facility.manage', at(ctx)))) {
        throw AppError.badRequest('Choose the child the referral is for (childId).');
      }
      const rows = await db.facility.findMany({
        where: { AND: [{ area: areaScopeWhere(ctx.userId, 'facility.manage', at(ctx)) }, ...filters] },
        include: facilityInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 500,
      });
      return {
        items: rows.map((f) => ({ ...toSummary(f), placement: 'IN_DISTRICT', selectable: isSelectable(f) })),
      };
    },
  };
}
