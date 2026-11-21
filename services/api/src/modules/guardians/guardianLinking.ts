import { randomUUID } from 'node:crypto';
import type { DuplicateGuardianDetails, GuardianRelationship } from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { denyAsNotFound, scopedWhere, type AccessContext } from '../access-control/accessScope';
import type { PermissionCode } from '../access-control/permissions';
import { recordAudit } from '../audit/audit.service';
import { maskStoredPhone } from '../children/childDto';

/**
 * Creating guardians and child-guardian links (decisions E, F, L). Runs inside the caller's
 * transaction. The caller has already verified access to the CHILD; this module verifies access
 * to every EXISTING guardian independently (never trusting an id from the client).
 */
export interface TxContext extends AccessContext {
  at: Date;
  /** Root client: denial audits must survive the transaction's rollback. */
  auditDb: PrismaClient;
}

/** A link request after Zod parsing (defaults applied). */
export interface ParsedGuardianLink {
  existingGuardianId?: string | undefined;
  newGuardian?: { fullName: string; phone?: string | undefined; preferredLanguage: 'hi' | 'en' } | undefined;
  relationship: GuardianRelationship;
  isPrimaryContact: boolean;
  canGiveConsent: boolean;
  confirmNewGuardian: boolean;
}

/** Serialises changes to one child's links (primary contact, last-guardian rule) across requests. */
export async function lockChildRow(tx: Prisma.TransactionClient, childId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${childId}::uuid FOR UPDATE`;
}

/** Checks that an existing guardian is linked to a child the user may use `permission` on. */
export async function assertGuardianInScope(
  tx: Prisma.TransactionClient,
  ctx: TxContext,
  guardianId: string,
  permission: PermissionCode,
  /**
   * The (already access-checked) child being linked. A guardian whose earlier link to THIS child
   * was ended may be linked again, even if they have no other current link - otherwise a
   * mistaken removal could only be repaired by creating a duplicate guardian.
   */
  childId?: string | null,
): Promise<void> {
  const inScope = await tx.guardian.count({
    where: {
      id: guardianId,
      deletedAt: null,
      OR: [
        scopedWhere.guardian(ctx.userId, permission, ctx.at),
        ...(childId ? [{ children: { some: { childId } } }] : []),
      ],
    },
  });
  if (inScope > 0) return;
  const exists = (await tx.guardian.count({ where: { id: guardianId } })) > 0;
  throw await denyAsNotFound(tx, ctx, 'guardian', guardianId, permission, exists, 'Guardian not found');
}

/**
 * In-scope guardians with the same phone number (decision G/F). Out-of-scope matches are never
 * returned or hinted at.
 */
export async function findInScopeGuardiansByPhoneHash(
  tx: Prisma.TransactionClient,
  ctx: TxContext,
  lookupHash: string,
  pii: PiiCrypto,
): Promise<DuplicateGuardianDetails['candidates']> {
  const rows = await tx.guardian.findMany({
    where: { phoneLookupHash: lookupHash, ...scopedWhere.guardian(ctx.userId, 'child.read', ctx.at) },
    select: { id: true, fullName: true, phoneEncrypted: true },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  return rows.map((row) => ({
    guardianId: row.id,
    fullName: row.fullName,
    phoneMasked: maskStoredPhone(pii, row.phoneEncrypted, row.id) ?? '',
  }));
}

/**
 * Validates every link request BEFORE anything is written: existing guardians must be in scope
 * and not already linked; new guardians with a phone number matching an in-scope guardian
 * produce a 409 POSSIBLE_DUPLICATE_GUARDIAN unless the worker confirmed.
 */
export async function checkGuardianLinks(
  tx: Prisma.TransactionClient,
  ctx: TxContext,
  childId: string | null,
  links: ParsedGuardianLink[],
  permission: PermissionCode,
  pii: PiiCrypto,
): Promise<void> {
  for (const [index, link] of links.entries()) {
    if (link.existingGuardianId) {
      await assertGuardianInScope(tx, ctx, link.existingGuardianId, permission, childId);
      if (childId) {
        const active = await tx.childGuardian.count({
          where: { childId, guardianId: link.existingGuardianId, endedAt: null },
        });
        if (active > 0) {
          throw AppError.conflict('GUARDIAN_ALREADY_LINKED', 'This guardian is already linked to the child');
        }
      }
    } else if (link.newGuardian?.phone && !link.confirmNewGuardian) {
      const candidates = await findInScopeGuardiansByPhoneHash(
        tx,
        ctx,
        pii.phoneLookupHash(link.newGuardian.phone),
        pii,
      );
      if (candidates.length > 0) {
        const details: DuplicateGuardianDetails = { guardianIndex: index, candidates };
        throw AppError.conflict(
          'POSSIBLE_DUPLICATE_GUARDIAN',
          'A guardian with this phone number is already registered. Select them, or confirm this is a different person.',
          details,
        );
      }
    }
  }
}

/** Creates new guardians and the links. Returns the link ids in request order. */
export async function createGuardianLinks(
  tx: Prisma.TransactionClient,
  ctx: TxContext,
  child: { id: string; areaId: string },
  links: ParsedGuardianLink[],
  pii: PiiCrypto,
): Promise<string[]> {
  const ids: string[] = [];
  for (const link of links) {
    let guardianId = link.existingGuardianId;
    if (!guardianId) {
      const input = link.newGuardian!;
      guardianId = randomUUID();
      await tx.guardian.create({
        data: {
          id: guardianId,
          fullName: input.fullName,
          preferredLanguage: input.preferredLanguage,
          ...(input.phone && {
            phoneEncrypted: pii.encryptPhone(input.phone, guardianId),
            phoneLookupHash: pii.phoneLookupHash(input.phone),
          }),
        },
      });
      await recordAudit(tx, {
        actorUserId: ctx.userId,
        action: 'guardian.created',
        entityType: 'guardian',
        entityId: guardianId,
        areaId: child.areaId,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
        details: {
          childId: child.id,
          hasPhone: Boolean(input.phone),
          duplicateWarningConfirmed: link.confirmNewGuardian,
        },
      });
    }

    if (link.isPrimaryContact) await clearPrimaryContact(tx, ctx, child);

    const row = await tx.childGuardian.create({
      data: {
        childId: child.id,
        guardianId,
        relationship: link.relationship,
        isPrimaryContact: link.isPrimaryContact,
        canGiveConsent: link.canGiveConsent,
        createdById: ctx.userId,
        createdAt: ctx.at,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorUserId: ctx.userId,
      action: 'child_guardian.linked',
      entityType: 'childGuardian',
      entityId: row.id,
      areaId: child.areaId,
      outcome: 'SUCCESS',
      requestId: ctx.requestId,
      details: {
        childId: child.id,
        guardianId,
        relationship: link.relationship,
        isPrimaryContact: link.isPrimaryContact,
        canGiveConsent: link.canGiveConsent,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

/** Removes the primary flag from the child's current primary link (one primary at a time). */
export async function clearPrimaryContact(
  tx: Prisma.TransactionClient,
  ctx: TxContext,
  child: { id: string; areaId: string },
  exceptLinkId?: string,
): Promise<void> {
  const current = await tx.childGuardian.findMany({
    where: {
      childId: child.id,
      endedAt: null,
      isPrimaryContact: true,
      ...(exceptLinkId && { id: { not: exceptLinkId } }),
    },
    select: { id: true },
  });
  for (const link of current) {
    await tx.childGuardian.update({ where: { id: link.id }, data: { isPrimaryContact: false } });
    await recordAudit(tx, {
      actorUserId: ctx.userId,
      action: 'child_guardian.updated',
      entityType: 'childGuardian',
      entityId: link.id,
      areaId: child.areaId,
      outcome: 'SUCCESS',
      requestId: ctx.requestId,
      details: { childId: child.id, changes: { isPrimaryContact: { from: true, to: false } } },
    });
  }
}
