import type { ProtocolStatus } from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import { hasPermissionAnywhere } from '../access-control/authorization.service';
import { recordAudit } from '../audit/audit.service';
import { normalizeLoginId } from '../auth/loginId';
import { protocolContentHash, protocolRowToDefinition } from './protocolContent';

/**
 * Governed protocol lifecycle (Step 6 decisions B, D, E). There is deliberately NO HTTP endpoint
 * for this: it is run by the person the programme designates, through
 * `npm run db:protocol-status` (prisma/protocol-status.ts), and every change is audited.
 *
 *   DRAFT -> IN_REVIEW     content validated and its SHA-256 fixed (what reviewers approve)
 *   IN_REVIEW -> DRAFT     sent back for rework (hash cleared; content editable again if unused)
 *   IN_REVIEW -> APPROVED  actor must hold screening.review; approval reference required;
 *                          content must still match the reviewed hash
 *   APPROVED -> ACTIVE     operational from effectiveFrom; no overlap with another ACTIVE
 *                          protocol of the same category and age (database exclusion constraint)
 *   APPROVED/ACTIVE -> RETIRED  no longer usable; kept forever for historical sessions
 *
 * The database triggers enforce the same rules for every account, so this module is the friendly
 * path, not the only guard. Demonstration content can never be approved (database CHECK).
 */
export class ProtocolLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolLifecycleError';
  }
}

export interface ProtocolStatusChange {
  code: string;
  version: number;
  to: ProtocolStatus;
  /** Login id of the person making the change (the approver for APPROVED). */
  actorLoginId: string;
  /** Required for APPROVED: approval document / committee minute reference. No personal data. */
  approvalReference?: string;
  /** For ACTIVE: when the protocol becomes operational (defaults to now). */
  effectiveFrom?: Date;
}

const ALLOWED: Record<ProtocolStatus, readonly ProtocolStatus[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['RETIRED'],
  RETIRED: [],
};

export async function changeProtocolStatus(
  db: PrismaClient,
  change: ProtocolStatusChange,
  now: Date = new Date(),
): Promise<{ id: string; from: ProtocolStatus; to: ProtocolStatus; contentSha256: string | null }> {
  const actor = await db.user.findUnique({ where: { loginId: normalizeLoginId(change.actorLoginId) } });
  if (!actor || actor.status !== 'ACTIVE') {
    throw new ProtocolLifecycleError('ACTOR_NOT_ACTIVE', 'The acting user does not exist or is not active');
  }
  if (change.to === 'APPROVED') {
    if (!(await hasPermissionAnywhere(db, actor.id, 'screening.review', now))) {
      throw new ProtocolLifecycleError(
        'APPROVER_NOT_AUTHORISED',
        'Only a user holding screening.review may record clinical approval (ASSUMPTION - programme to confirm the approver role)',
      );
    }
    if (!change.approvalReference?.trim()) {
      throw new ProtocolLifecycleError('APPROVAL_REFERENCE_REQUIRED', 'An approval reference is required');
    }
  }

  try {
    return await db.$transaction(async (tx) => {
      // Lock the protocol row: serialises with question edits and category starts.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "ScreeningProtocol" WHERE code = ${change.code} AND version = ${change.version} FOR UPDATE`;
      if (locked.length === 0) {
        throw new ProtocolLifecycleError(
          'PROTOCOL_NOT_FOUND',
          `Protocol ${change.code} v${change.version} not found`,
        );
      }
      const row = await tx.screeningProtocol.findUniqueOrThrow({
        where: { id: locked[0]!.id },
        include: { questions: true },
      });
      const from = row.status;
      if (!ALLOWED[from].includes(change.to)) {
        throw new ProtocolLifecycleError(
          'INVALID_TRANSITION',
          `Cannot change status from ${from} to ${change.to}`,
        );
      }
      if (row.isDemonstration && ['APPROVED', 'ACTIVE', 'RETIRED'].includes(change.to)) {
        throw new ProtocolLifecycleError(
          'DEMONSTRATION_NOT_APPROVABLE',
          'Demonstration content can never be approved or made operational',
        );
      }

      // Validates stored content (throws on anything that is not a valid protocol).
      const currentHash = protocolContentHash(protocolRowToDefinition(row));
      if (from !== 'DRAFT' && change.to !== 'DRAFT' && currentHash !== row.contentSha256) {
        throw new ProtocolLifecycleError(
          'CONTENT_CHANGED',
          'Stored content no longer matches the reviewed hash; investigate before continuing',
        );
      }

      const data: Prisma.ScreeningProtocolUpdateInput = { status: change.to };
      if (change.to === 'IN_REVIEW') data.contentSha256 = currentHash;
      if (change.to === 'DRAFT') data.contentSha256 = null;
      if (change.to === 'APPROVED') {
        data.clinicalApprovedBy = { connect: { id: actor.id } };
        data.clinicalApprovedAt = now;
        data.approvalReference = change.approvalReference!.trim();
      }
      if (change.to === 'ACTIVE') data.effectiveFrom = change.effectiveFrom ?? now;
      if (change.to === 'RETIRED') data.retiredAt = now;

      const updated = await tx.screeningProtocol.update({ where: { id: row.id }, data });
      await recordAudit(tx, {
        actorUserId: actor.id,
        action: 'screening_protocol.status_changed',
        entityType: 'screeningProtocol',
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
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      if (error.message.includes('screening_protocol_one_active_per_band')) {
        throw new ProtocolLifecycleError(
          'ACTIVE_OVERLAP',
          'Another ACTIVE protocol of this category already covers part of this age band; retire it first',
        );
      }
    }
    throw error;
  }
}
