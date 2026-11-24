import {
  ageOn,
  formatCalendarDate,
  parseCalendarDate,
  todayInIndia,
  type ParentChild,
  type ParentChildDetail,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { recordAudit } from '../audit/audit.service';
import type { ParentAuthContext } from './parentAuth.service';

/**
 * What a signed-in parent may see (Step 8 stage 6; PP11, PP12, PP16).
 *
 * Access rule, applied in EVERY query (never trusting a child id from the app): the child is not
 * deleted, and has an ACTIVE GuardianChildAccess row for the guardian of THIS parent account whose
 * guardian-child link is still active. The guardian comes from the account in the database, not
 * from the request. Anything else - another family's child, a revoked or ended link, an unknown
 * id - is the same 404, and the attempt is audited.
 *
 * Shown: name, age, centre, worker name, upcoming check-up and appointment dates. Never: screening
 * results, risk levels, notes, referral reasons, diagnoses, phone numbers.
 */
const UPCOMING_FOLLOW_UP = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] as const;
const WORKER_ROLES = ['ASHA', 'ANGANWADI_WORKER'];

export function createParentChildrenService({
  db,
  now = () => new Date(),
}: {
  db: PrismaClient;
  now?: () => Date;
}) {
  async function guardianOf(auth: ParentAuthContext): Promise<string> {
    const account = await db.parentAccount.findUniqueOrThrow({
      where: { id: auth.parentAccountId },
      select: { guardianId: true },
    });
    return account.guardianId;
  }

  const visibleTo = (guardianId: string): Prisma.ChildWhereInput => ({
    deletedAt: null,
    parentAccess: {
      some: { guardianId, status: 'ACTIVE', childGuardian: { guardianId, endedAt: null } },
    },
  });

  async function build(childIds: string[], at: Date, detail: boolean) {
    if (childIds.length === 0) return [];
    const today = todayInIndia(at);
    const todayDate = new Date(`${formatCalendarDate(today)}T00:00:00.000Z`);
    const children = await db.child.findMany({
      where: { id: { in: childIds } },
      select: {
        id: true,
        fullName: true,
        dateOfBirth: true,
        dobIsEstimated: true,
        areaId: true,
        area: { select: { nameEn: true, nameHi: true } },
        followUps: {
          where: { status: { in: [...UPCOMING_FOLLOW_UP] }, dueDate: { gte: todayDate } },
          orderBy: { dueDate: 'asc' },
          take: detail ? 10 : 1,
          select: { dueDate: true },
        },
        referrals: {
          where: { status: 'APPOINTMENT_SCHEDULED', appointmentAt: { gte: at } },
          orderBy: { appointmentAt: 'asc' },
          take: detail ? 10 : 1,
          select: { appointmentAt: true, facility: { select: { name: true } } },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    const areaIds = [...new Set(children.map((c) => c.areaId))];
    const assignments = await db.workerAreaAssignment.findMany({
      where: {
        areaId: { in: areaIds },
        status: 'ACTIVE',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        role: { code: { in: WORKER_ROLES } },
        user: { status: 'ACTIVE' },
      },
      orderBy: [{ effectiveFrom: 'asc' }],
      select: { areaId: true, role: { select: { code: true } }, user: { select: { displayName: true } } },
    });
    const workerFor = (areaId: string) => {
      const here = assignments.filter((a) => a.areaId === areaId);
      return (here.find((a) => a.role.code === 'ASHA') ?? here[0])?.user.displayName ?? null;
    };
    return children.map((c) => {
      const age = ageOn(parseCalendarDate(c.dateOfBirth.toISOString().slice(0, 10))!, today);
      const checkUps = c.followUps.map((f) => f.dueDate.toISOString().slice(0, 10));
      const appointments = c.referrals.map((r) => ({
        at: r.appointmentAt!.toISOString(),
        facilityName: r.facility?.name ?? null,
      }));
      const base: ParentChild = {
        childId: c.id,
        fullName: c.fullName,
        ageYears: age.years,
        ageMonths: age.months,
        dobIsEstimated: c.dobIsEstimated,
        centre: { nameEn: c.area.nameEn, nameHi: c.area.nameHi },
        workerName: workerFor(c.areaId),
        nextCheckUp: checkUps[0] ?? null,
        nextAppointment: appointments[0] ?? null,
      };
      return detail ? { ...base, upcomingCheckUps: checkUps, upcomingAppointments: appointments } : base;
    });
  }

  return {
    async list(auth: ParentAuthContext): Promise<ParentChild[]> {
      const guardianId = await guardianOf(auth);
      const rows = await db.child.findMany({ where: visibleTo(guardianId), select: { id: true } });
      return build(
        rows.map((r) => r.id),
        now(),
        false,
      );
    },

    async get(auth: ParentAuthContext, childId: string, requestId?: string): Promise<ParentChildDetail> {
      const guardianId = await guardianOf(auth);
      const visible = await db.child.findFirst({
        where: { id: childId, ...visibleTo(guardianId) },
        select: { id: true },
      });
      if (!visible) {
        await recordAudit(db, {
          actorParentAccountId: auth.parentAccountId,
          action: 'parent_child.access_denied',
          entityType: 'child',
          entityId: childId,
          outcome: 'DENIED',
          requestId,
        });
        throw AppError.notFound('Child not found');
      }
      const [child] = await build([childId], now(), true);
      await recordAudit(db, {
        actorParentAccountId: auth.parentAccountId,
        action: 'parent_child.viewed',
        entityType: 'child',
        entityId: childId,
        outcome: 'SUCCESS',
        requestId,
      });
      return child as ParentChildDetail;
    },
  };
}
