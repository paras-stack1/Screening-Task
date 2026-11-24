import { todayInIndia, formatCalendarDate } from '@balswasthya/shared-contracts';
import type { Facility } from '@prisma/client';
import type { Db } from '../../config/database';
import { AppError } from '../../utils/AppError';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { assignmentCoversAreaWhere, effectiveAssignmentWhere } from '../access-control/accessScope';
import type { PermissionCode } from '../access-control/permissions';

/**
 * Helpers shared by clinical review, referrals and follow-ups (Step 7 stage 7C).
 */

// ------------------------------------------------------------------ free text (decision V)

/**
 * Step 7 free text (review notes, referral reasons, status notes, follow-up notes) encrypted with
 * the existing `enc1:` scheme, bound to the record and field: a value moved elsewhere does not
 * decrypt. Never logged, never in audit details or notifications.
 */
export type RecordField =
  | { kind: 'review'; id: string; field: 'notes' }
  | { kind: 'reviewEvent'; id: string; field: 'notes' }
  | { kind: 'referral'; id: string; field: 'reasonNote' | 'outOfDistrictReason' }
  | { kind: 'referralEvent'; id: string; field: 'reason' | 'note' }
  | { kind: 'followUp'; id: string; field: 'reasonNote' | 'nextAction' | 'outcomeNote' }
  | { kind: 'followUpEvent'; id: string; field: 'reason' };

export interface RecordText {
  seal(f: RecordField, value: string | null | undefined): string | null;
  open(f: RecordField, value: string | null): string | null;
}

export function recordText(pii: PiiCrypto): RecordText {
  const context = (f: RecordField) => `step7:${f.kind}:${f.id}:${f.field}`;
  return {
    seal: (f, value) => (value === null || value === undefined ? null : pii.encryptText(value, context(f))),
    open: (f, value) => (value === null ? null : pii.decryptText(value, context(f))),
  };
}

// ------------------------------------------------------------------ actor role

/**
 * Role code under which the user holds `permission` over `areaId` (for history records). The
 * permission has already been checked; this only names the role (lowest role code if several).
 */
export async function actorRoleCode(
  db: Db,
  userId: string,
  areaId: string,
  permission: PermissionCode,
  at: Date,
): Promise<string> {
  const assignment = await db.workerAreaAssignment.findFirst({
    where: effectiveAssignmentWhere(userId, permission, at, assignmentCoversAreaWhere(areaId)),
    select: { role: { select: { code: true } } },
    orderBy: { role: { code: 'asc' } },
  });
  return assignment?.role.code ?? 'UNKNOWN';
}

/** Permissions the user holds over the child's CURRENT area (decision D4). */
export { permissionsOverArea } from '../access-control/authorization.service';

// ------------------------------------------------------------------ facility placement

/** The child's district: the ancestor area at level DISTRICT (null if the tree has none). */
async function districtOf(db: Db, areaId: string): Promise<string | null> {
  const link = await db.areaClosure.findFirst({
    where: { descendantId: areaId, ancestor: { level: { code: 'DISTRICT' } } },
    select: { ancestorId: true },
  });
  return link?.ancestorId ?? null;
}

/**
 * Decision P (ASSUMPTION - programme to confirm): a facility is IN_DISTRICT when it lies inside
 * the child's district or above it (state level); anything else is OUT_OF_DISTRICT and needs an
 * approver with a reason. The nearest facility is never assumed to be the right one.
 */
export async function facilityPlacement(
  db: Db,
  childAreaId: string,
  facilityAreaId: string,
): Promise<'IN_DISTRICT' | 'OUT_OF_DISTRICT'> {
  const district = await districtOf(db, childAreaId);
  const root = district ?? childAreaId;
  const inside = await db.areaClosure.count({ where: { ancestorId: root, descendantId: facilityAreaId } });
  if (inside > 0) return 'IN_DISTRICT';
  const above = await db.areaClosure.count({ where: { ancestorId: facilityAreaId, descendantId: root } });
  return above > 0 ? 'IN_DISTRICT' : 'OUT_OF_DISTRICT';
}

export const isSelectable = (f: Pick<Facility, 'isActive' | 'verificationStatus' | 'acceptsReferrals'>) =>
  f.isActive && f.verificationStatus === 'VERIFIED' && f.acceptsReferrals;

/**
 * Validates a facility chosen for a referral. Inactive, unverified or not-accepting facilities are
 * refused (422). Out-of-district needs `mayGoOutOfDistrict` (an approver) AND a reason.
 */
export async function assertFacilityChoice(
  db: Db,
  childAreaId: string,
  facilityId: string,
  options: { mayGoOutOfDistrict: boolean; outOfDistrictReason?: string | undefined },
): Promise<{ facility: Facility; placement: 'IN_DISTRICT' | 'OUT_OF_DISTRICT' }> {
  const facility = await db.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw AppError.unprocessable('FACILITY_NOT_FOUND', 'This facility does not exist.');
  if (!isSelectable(facility)) {
    throw AppError.unprocessable(
      'FACILITY_NOT_AVAILABLE',
      'This facility is inactive, not verified or not accepting referrals.',
    );
  }
  const placement = await facilityPlacement(db, childAreaId, facility.areaId);
  if (placement === 'OUT_OF_DISTRICT') {
    if (!options.mayGoOutOfDistrict) {
      throw AppError.unprocessable(
        'FACILITY_OUT_OF_DISTRICT',
        "This facility is outside the child's district. A medical officer must choose it.",
      );
    }
    if (!options.outOfDistrictReason) {
      throw AppError.unprocessable(
        'OUT_OF_DISTRICT_REASON_REQUIRED',
        'Give the reason for choosing a facility outside the district.',
      );
    }
  }
  return { facility, placement };
}

// ------------------------------------------------------------------ dates

/** A due date (YYYY-MM-DD, India) from today to one year ahead; returned as a DATE value. */
export function dueDateFrom(value: string, now: Date): Date {
  const today = formatCalendarDate(todayInIndia(now));
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  if (!valid || value < today || date.getTime() > Date.parse(`${today}T00:00:00Z`) + 366 * 86_400_000) {
    throw AppError.unprocessable(
      'INVALID_DUE_DATE',
      'The due date must be a real date from today up to one year ahead.',
    );
  }
  return date;
}
