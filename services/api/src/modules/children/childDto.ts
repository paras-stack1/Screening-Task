import {
  maskIndianMobile,
  type ChildDetail,
  type ChildSummary,
  type GuardianLink,
} from '@balswasthya/shared-contracts';
import type { Prisma } from '@prisma/client';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { formatDbDate } from './birthDate';

/**
 * Explicit response DTOs: Prisma rows are never returned directly. Selects list exactly the
 * columns a screen needs; deletion fields, creator ids and phone ciphertext never leave the API.
 */
export const childSummarySelect = {
  id: true,
  fullName: true,
  dateOfBirth: true,
  dobIsEstimated: true,
  sexAtBirth: true,
  areaId: true,
  createdAt: true,
  area: { select: { nameEn: true, nameHi: true } },
} satisfies Prisma.ChildSelect;

export function toChildSummary(
  row: Prisma.ChildGetPayload<{ select: typeof childSummarySelect }>,
): ChildSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    dateOfBirth: formatDbDate(row.dateOfBirth),
    dobIsEstimated: row.dobIsEstimated,
    sexAtBirth: row.sexAtBirth,
    areaId: row.areaId,
    areaName: row.area.nameEn,
    areaNameHi: row.area.nameHi,
    registeredAt: row.createdAt.toISOString(),
  };
}

export const guardianLinkSelect = {
  id: true,
  relationship: true,
  isPrimaryContact: true,
  canGiveConsent: true,
  createdAt: true,
  endedAt: true,
  guardian: { select: { id: true, fullName: true, phoneEncrypted: true, preferredLanguage: true } },
} satisfies Prisma.ChildGuardianSelect;

export type GuardianLinkRow = Prisma.ChildGuardianGetPayload<{ select: typeof guardianLinkSelect }>;

/** Current links first (primary contact first), then by link date. */
export const guardianLinkOrder: Prisma.ChildGuardianOrderByWithRelationInput[] = [
  { isPrimaryContact: 'desc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/**
 * Masked form of a stored number. If the keys are not configured, the number cannot be read, so
 * only the fact that one is saved is shown.
 */
export function maskStoredPhone(
  pii: PiiCrypto,
  stored: Uint8Array | null,
  guardianId: string,
): string | null {
  if (!stored) return null;
  if (!pii.available) return '+91 ••••••••••';
  return maskIndianMobile(pii.decryptPhone(stored, guardianId));
}

export function toGuardianLink(row: GuardianLinkRow, pii: PiiCrypto): GuardianLink {
  return {
    relationshipId: row.id,
    guardianId: row.guardian.id,
    fullName: row.guardian.fullName,
    relationship: row.relationship,
    isPrimaryContact: row.isPrimaryContact,
    canGiveConsent: row.canGiveConsent,
    phoneMasked: maskStoredPhone(pii, row.guardian.phoneEncrypted, row.guardian.id),
    preferredLanguage: row.guardian.preferredLanguage,
    linkedAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

export const childDetailSelect = {
  ...childSummarySelect,
  updatedAt: true,
  createdBy: { select: { displayName: true } },
  guardians: {
    where: { endedAt: null, guardian: { deletedAt: null } },
    select: guardianLinkSelect,
    orderBy: guardianLinkOrder,
  },
} satisfies Prisma.ChildSelect;

export function toChildDetail(
  row: Prisma.ChildGetPayload<{ select: typeof childDetailSelect }>,
  pii: PiiCrypto,
): ChildDetail {
  return {
    ...toChildSummary(row),
    updatedAt: row.updatedAt.toISOString(),
    registeredByName: row.createdBy.displayName,
    guardians: row.guardians.map((link) => toGuardianLink(link, pii)),
  };
}
