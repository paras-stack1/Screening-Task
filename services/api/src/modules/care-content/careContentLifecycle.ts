import type { CareContentDefinition, ProtocolStatus } from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import { hasPermissionAnywhere } from '../access-control/authorization.service';
import { recordAudit } from '../audit/audit.service';
import { normalizeLoginId } from '../auth/loginId';
import { careContentCreateInput, careContentHash, careContentRowToDefinition } from './careContentDefinition';

/**
 * Governed care content lifecycle (Step 8 decisions C2, C4). Deliberately NO HTTP endpoint: the
 * person the programme designates runs `npm run db:care-content-import` and
 * `npm run db:care-content-status`; every change writes a CareContentEvent and an audit record.
 *
 *   import (DRAFT)          definition validated (format, kind, source, permission, video link)
 *   DRAFT -> IN_REVIEW      SHA-256 fixed (what reviewers approve)
 *   IN_REVIEW -> DRAFT      sent back for rework (hash cleared)
 *   IN_REVIEW -> APPROVED   approver holds screening.review (decision C4, ASSUMPTION as for
 *                           protocols); approval reference required; content must match the hash
 *   APPROVED -> ACTIVE      offered from effectiveFrom; one ACTIVE version per code (DB index)
 *   APPROVED/ACTIVE -> RETIRED
 *
 * The database triggers enforce the same rules for every account. Demonstration items can never be
 * approved (database CHECK and this module).
 */
export class CareContentLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CareContentLifecycleError';
  }
}

const ALLOWED: Record<ProtocolStatus, readonly ProtocolStatus[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['RETIRED'],
  RETIRED: [],
};

async function activeActor(db: PrismaClient | Prisma.TransactionClient, loginId: string) {
  const actor = await db.user.findUnique({ where: { loginId: normalizeLoginId(loginId) } });
  if (!actor || actor.status !== 'ACTIVE') {
    throw new CareContentLifecycleError(
      'ACTOR_NOT_ACTIVE',
      'The acting user does not exist or is not active',
    );
  }
  return actor;
}

/**
 * Imports a content item as DRAFT. Re-importing identical content is a no-op; the same code and
 * version with different content is refused (create a new version instead).
 */
export async function importCareContent(
  db: PrismaClient,
  def: CareContentDefinition,
  actorLoginId: string | null,
): Promise<{ id: string; created: boolean }> {
  const actor = actorLoginId ? await activeActor(db, actorLoginId) : null;
  if (!actor && !def.isDemonstration) {
    throw new CareContentLifecycleError(
      'ACTOR_REQUIRED',
      'Only demonstration content can be created without an actor',
    );
  }
  const hash = careContentHash(def);
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.careContent.findUnique({
        where: { code_version: { code: def.code, version: def.version } },
      });
      if (existing) {
        if (careContentHash(careContentRowToDefinition(existing)) !== hash) {
          throw new CareContentLifecycleError(
            'VERSION_EXISTS',
            `Care content ${def.code} v${def.version} already exists with different content; create a new version`,
          );
        }
        return { id: existing.id, created: false };
      }
      const created = await tx.careContent.create({ data: careContentCreateInput(def, actor?.id ?? null) });
      await tx.careContentEvent.create({
        data: {
          contentId: created.id,
          type: 'CREATED',
          toStatus: 'DRAFT',
          actorId: actor?.id ?? null,
          contentSha256: hash,
        },
      });
      await recordAudit(tx, {
        actorUserId: actor?.id,
        action: 'care_content.created',
        entityType: 'careContent',
        entityId: created.id,
        outcome: 'SUCCESS',
        details: {
          code: def.code,
          version: def.version,
          kind: def.kind,
          isDemonstration: def.isDemonstration,
          via: actor ? 'admin-script' : 'dev-seed',
        },
      });
      return { id: created.id, created: true };
    });
  } catch (error) {
    // Two imports of the same new version at once: the loser sees the unique index.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new CareContentLifecycleError(
        'VERSION_EXISTS',
        `Care content ${def.code} v${def.version} was created at the same time; run the import again`,
      );
    }
    throw error;
  }
}

export interface CareContentStatusChange {
  code: string;
  version: number;
  to: ProtocolStatus;
  actorLoginId: string;
  approvalReference?: string;
  effectiveFrom?: Date;
}

export async function changeCareContentStatus(
  db: PrismaClient,
  change: CareContentStatusChange,
  now: Date = new Date(),
): Promise<{ id: string; from: ProtocolStatus; to: ProtocolStatus; contentSha256: string | null }> {
  const actor = await activeActor(db, change.actorLoginId);
  if (change.to === 'APPROVED') {
    if (!(await hasPermissionAnywhere(db, actor.id, 'screening.review', now))) {
      throw new CareContentLifecycleError(
        'APPROVER_NOT_AUTHORISED',
        'Only a user holding screening.review may record content approval (ASSUMPTION - programme to confirm the approver role)',
      );
    }
    if (!change.approvalReference?.trim()) {
      throw new CareContentLifecycleError('APPROVAL_REFERENCE_REQUIRED', 'An approval reference is required');
    }
  }
  try {
    return await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "CareContent" WHERE code = ${change.code} AND version = ${change.version} FOR UPDATE`;
      if (locked.length === 0) {
        throw new CareContentLifecycleError(
          'CONTENT_NOT_FOUND',
          `Care content ${change.code} v${change.version} not found`,
        );
      }
      const row = await tx.careContent.findUniqueOrThrow({ where: { id: locked[0]!.id } });
      const from = row.status;
      if (!ALLOWED[from].includes(change.to)) {
        throw new CareContentLifecycleError(
          'INVALID_TRANSITION',
          `Cannot change status from ${from} to ${change.to}`,
        );
      }
      if (row.isDemonstration && ['APPROVED', 'ACTIVE', 'RETIRED'].includes(change.to)) {
        throw new CareContentLifecycleError(
          'DEMONSTRATION_NOT_APPROVABLE',
          'Demonstration content can never be approved or offered to families',
        );
      }
      const currentHash = careContentHash(careContentRowToDefinition(row)); // throws on invalid content
      if (from !== 'DRAFT' && change.to !== 'DRAFT' && currentHash !== row.contentSha256) {
        throw new CareContentLifecycleError(
          'CONTENT_CHANGED',
          'Stored content no longer matches the reviewed hash; investigate before continuing',
        );
      }

      if (change.to === 'ACTIVE') {
        const other = await tx.careContent.findFirst({
          where: { code: row.code, status: 'ACTIVE', id: { not: row.id } },
          select: { version: true },
        });
        if (other) {
          throw new CareContentLifecycleError(
            'ACTIVE_VERSION_EXISTS',
            `Version ${other.version} of ${row.code} is ACTIVE; retire it first`,
          );
        }
      }

      const data: Prisma.CareContentUpdateInput = { status: change.to };
      if (change.to === 'IN_REVIEW') data.contentSha256 = currentHash;
      if (change.to === 'DRAFT') data.contentSha256 = null;
      if (change.to === 'APPROVED') {
        data.approvedBy = { connect: { id: actor.id } };
        data.approvedAt = now;
        data.approvalReference = change.approvalReference!.trim();
      }
      if (change.to === 'ACTIVE') data.effectiveFrom = change.effectiveFrom ?? now;
      if (change.to === 'RETIRED') data.retiredAt = now;

      const updated = await tx.careContent.update({ where: { id: row.id }, data });
      await tx.careContentEvent.create({
        data: {
          contentId: row.id,
          type: 'STATUS_CHANGED',
          fromStatus: from,
          toStatus: change.to,
          actorId: actor.id,
          reference: change.to === 'APPROVED' ? updated.approvalReference : null,
          contentSha256: updated.contentSha256 ?? currentHash,
        },
      });
      await recordAudit(tx, {
        actorUserId: actor.id,
        action: 'care_content.status_changed',
        entityType: 'careContent',
        entityId: row.id,
        outcome: 'SUCCESS',
        details: {
          code: row.code,
          version: row.version,
          from,
          to: change.to,
          contentSha256: updated.contentSha256,
          ...(change.to === 'APPROVED' ? { approvalReference: updated.approvalReference } : {}),
          ...(change.to === 'ACTIVE' ? { effectiveFrom: updated.effectiveFrom?.toISOString() ?? null } : {}),
          via: 'admin-script',
        },
      });
      return { id: row.id, from, to: change.to, contentSha256: updated.contentSha256 };
    });
  } catch (error) {
    // Backstop for two activations at once: the partial unique index refuses the second.
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
      ((error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError) &&
        error.message.includes('care_content_one_active_version'))
    ) {
      throw new CareContentLifecycleError(
        'ACTIVE_VERSION_EXISTS',
        'Another version of this content is ACTIVE; retire it first',
      );
    }
    throw error;
  }
}
