import type {
  CreateFacilityRequest,
  FacilityDetail,
  FacilityReasonRequest,
  UpdateFacilityRequest,
  VerifyFacilityRequest,
} from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { areaScopeWhere, type AccessContext } from '../access-control/accessScope';
import { recordAudit } from '../audit/audit.service';

/**
 * Facility administration (Step 7 decision P; docs/step-7/facility-management.md). Only
 * facility.manage holders whose area scope covers the facility's area (district / state
 * administrators). Rules, also enforced by the database:
 *  - a new facility is UNVERIFIED and does not accept referrals;
 *  - services and "accepts referrals" can be recorded only together with a verification
 *    (who, when, reference) - capacity or specialist availability are never invented;
 *  - deactivation keeps the facility and every referral that used it; nothing is deleted;
 *  - every change bumps the version (409 on a stale one) and writes FacilityHistory + audit.
 * Facilities hold no child data. Text fields are plain (official, non-personal information).
 */
export function createFacilityAdminService({ db }: { db: PrismaClient }) {
  const at = (ctx: AccessContext) => ctx.at ?? new Date();
  const inScope = (ctx: AccessContext): Prisma.FacilityWhereInput => ({
    area: areaScopeWhere(ctx.userId, 'facility.manage', at(ctx)),
  });

  async function detail(ctx: AccessContext, id: string): Promise<FacilityDetail> {
    const f = await db.facility.findUnique({
      where: { id },
      include: {
        verifiedBy: { select: { displayName: true } },
        area: {
          select: { ancestorLinks: { select: { depth: true, ancestor: { select: { nameEn: true } } } } },
        },
        history: {
          include: { actor: { select: { displayName: true } } },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!f) throw AppError.notFound('Facility not found');
    const canManage = (await db.facility.count({ where: { id, ...inScope(ctx) } })) > 0;
    return {
      id: f.id,
      name: f.name,
      nameHi: f.nameHi,
      officialCode: f.officialCode,
      type: f.type,
      areaId: f.areaId,
      areaPath: [...f.area.ancestorLinks].sort((a, b) => b.depth - a.depth).map((l) => l.ancestor.nameEn),
      address: f.address,
      contactPhone: f.contactPhone,
      services: f.services,
      acceptsReferrals: f.acceptsReferrals,
      verificationStatus: f.verificationStatus,
      isActive: f.isActive,
      version: f.version,
      verifiedByName: f.verifiedBy?.displayName ?? null,
      verifiedAt: f.verifiedAt?.toISOString() ?? null,
      verificationReference: f.verificationReference,
      deactivatedAt: f.deactivatedAt?.toISOString() ?? null,
      deactivationReason: f.deactivationReason,
      history: f.history.map((h) => ({
        action: h.action,
        changes: h.changes as Record<string, unknown>,
        reason: h.reason,
        actorName: h.actor.displayName,
        occurredAt: h.occurredAt.toISOString(),
      })),
      canManage,
    };
  }

  const duplicate = () =>
    AppError.conflict(
      'FACILITY_DUPLICATE',
      'A facility with this official code, or this name and type in this area, already exists.',
    );

  async function denied(ctx: AccessContext, id: string | null, action: string) {
    await recordAudit(db, {
      actorUserId: ctx.userId,
      action: 'facility.access_denied',
      entityType: 'facility',
      entityId: id ?? undefined,
      outcome: 'DENIED',
      requestId: ctx.requestId,
      details: { action },
    });
    return AppError.notFound('Facility not found');
  }

  /** Guarded change: scope (404 + audit) -> lock -> version (409) -> update + history + audit. */
  async function change(
    ctx: AccessContext,
    id: string,
    expectedVersion: number,
    action: string,
    decide: (f: Prisma.FacilityGetPayload<object>) => {
      data: Prisma.FacilityUncheckedUpdateInput;
      changes: Prisma.InputJsonObject;
      reason?: string | null;
    },
  ): Promise<FacilityDetail> {
    if ((await db.facility.count({ where: { id, ...inScope(ctx) } })) === 0)
      throw await denied(ctx, id, action);
    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Facility" WHERE id = ${id}::uuid FOR UPDATE`;
        const f = await tx.facility.findUniqueOrThrow({ where: { id } });
        if (f.version !== expectedVersion) {
          throw AppError.conflict(
            'VERSION_CONFLICT',
            'This facility was changed elsewhere. Reload it first.',
            {
              currentVersion: f.version,
            },
          );
        }
        const c = decide(f);
        await tx.facility.update({
          where: { id },
          data: { ...c.data, updatedById: ctx.userId, version: { increment: 1 } },
        });
        await tx.facilityHistory.create({
          data: { facilityId: id, action, changes: c.changes, reason: c.reason ?? null, actorId: ctx.userId },
        });
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: `facility.${action.toLowerCase()}`,
          entityType: 'facility',
          entityId: id,
          areaId: f.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: c.changes,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicate();
      throw error;
    }
    return detail(ctx, id);
  }

  return {
    detail,

    async create(ctx: AccessContext, body: CreateFacilityRequest): Promise<FacilityDetail> {
      const area = await db.area.findFirst({
        where: { id: body.areaId, isActive: true, ...areaScopeWhere(ctx.userId, 'facility.manage', at(ctx)) },
        select: { id: true },
      });
      if (!area) throw await denied(ctx, null, 'CREATED');
      try {
        const id = await db.$transaction(async (tx) => {
          const f = await tx.facility.create({
            data: {
              name: body.name,
              nameHi: body.nameHi ?? null,
              officialCode: body.officialCode ?? null,
              type: body.type,
              areaId: body.areaId,
              address: body.address ?? null,
              contactPhone: body.contactPhone ?? null,
              createdById: ctx.userId,
            },
          });
          const changes = { name: f.name, type: f.type, areaId: f.areaId, officialCode: f.officialCode };
          await tx.facilityHistory.create({
            data: { facilityId: f.id, action: 'CREATED', changes, actorId: ctx.userId },
          });
          await recordAudit(tx, {
            actorUserId: ctx.userId,
            action: 'facility.created',
            entityType: 'facility',
            entityId: f.id,
            areaId: f.areaId,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            details: changes,
          });
          return f.id;
        });
        return detail(ctx, id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw duplicate();
        throw error;
      }
    },

    update(ctx: AccessContext, id: string, body: UpdateFacilityRequest) {
      return change(ctx, id, body.expectedVersion, 'UPDATED', (f) => {
        const fields = ['name', 'nameHi', 'officialCode', 'type', 'address', 'contactPhone'] as const;
        const data: Prisma.FacilityUncheckedUpdateInput = {};
        const changes: Record<string, { from: string | null; to: string | null }> = {};
        for (const k of fields) {
          const next = body[k];
          if (next === undefined || next === f[k]) continue;
          (data as Record<string, unknown>)[k] = next;
          changes[k] = { from: f[k], to: next };
        }
        if (Object.keys(changes).length === 0)
          throw AppError.unprocessable('NO_CHANGE', 'Nothing was changed.');
        return { data, changes, reason: body.reason };
      });
    },

    verify(ctx: AccessContext, id: string, body: VerifyFacilityRequest) {
      return change(ctx, id, body.expectedVersion, 'VERIFIED', (f) => {
        if (!f.isActive && body.acceptsReferrals) {
          throw AppError.unprocessable(
            'FACILITY_INACTIVE',
            'An inactive facility cannot accept referrals. Reactivate it first.',
          );
        }
        const services = [...new Set(body.services)].sort();
        return {
          data: {
            verificationStatus: 'VERIFIED',
            verifiedById: ctx.userId,
            verifiedAt: at(ctx),
            verificationReference: body.verificationReference,
            services,
            acceptsReferrals: body.acceptsReferrals,
          },
          changes: {
            services,
            acceptsReferrals: body.acceptsReferrals,
            verificationReference: body.verificationReference,
          },
        };
      });
    },

    unverify(ctx: AccessContext, id: string, body: FacilityReasonRequest) {
      return change(ctx, id, body.expectedVersion, 'UNVERIFIED', () => ({
        data: {
          verificationStatus: 'UNVERIFIED',
          verifiedById: null,
          verifiedAt: null,
          verificationReference: null,
          services: [],
          acceptsReferrals: false,
        },
        changes: { acceptsReferrals: false, services: [] },
        reason: body.reason,
      }));
    },

    deactivate(ctx: AccessContext, id: string, body: FacilityReasonRequest) {
      return change(ctx, id, body.expectedVersion, 'DEACTIVATED', (f) => {
        if (!f.isActive) throw AppError.conflict('ALREADY_INACTIVE', 'This facility is already inactive.');
        return {
          data: {
            isActive: false,
            acceptsReferrals: false,
            deactivatedAt: at(ctx),
            deactivationReason: body.reason,
          },
          changes: { isActive: false, acceptsReferrals: false },
          reason: body.reason,
        };
      });
    },

    reactivate(ctx: AccessContext, id: string, body: FacilityReasonRequest) {
      return change(ctx, id, body.expectedVersion, 'REACTIVATED', (f) => {
        if (f.isActive) throw AppError.conflict('ALREADY_ACTIVE', 'This facility is already active.');
        // Accepting referrals again needs a new verification decision.
        return {
          data: { isActive: true, deactivatedAt: null, deactivationReason: null },
          changes: { isActive: true },
          reason: body.reason,
        };
      });
    },
  };
}
