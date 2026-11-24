import type { ClinicalRuleSetDefinition, ProtocolStatus } from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import { hasPermissionAnywhere } from '../access-control/authorization.service';
import { recordAudit } from '../audit/audit.service';
import { normalizeLoginId } from '../auth/loginId';
import {
  ruleSetContentHash,
  ruleSetCreateInput,
  ruleSetRowToDefinition,
  validateAgainstProtocols,
  type ProtocolForValidation,
} from './ruleSetContent';

/**
 * Governed clinical rule-set lifecycle (Step 7 decision B). Deliberately NO HTTP endpoint: the
 * person the programme designates runs `npm run db:rule-set-import` and `npm run db:rule-set-status`;
 * every change writes a ClinicalRuleSetEvent and an audit record.
 *
 *   import (DRAFT)          definition validated against the protocol versions it names
 *   DRAFT -> IN_REVIEW      re-validated; SHA-256 fixed (what reviewers approve)
 *   IN_REVIEW -> DRAFT      sent back for rework (hash cleared)
 *   IN_REVIEW -> APPROVED   approver holds screening.review (ASSUMPTION, same as protocols);
 *                           approval reference required; content must still match the hash
 *   APPROVED -> ACTIVE      operational from effectiveFrom; no overlapping ACTIVE set (DB constraint)
 *   APPROVED/ACTIVE -> RETIRED
 *
 * The database triggers enforce the same rules for every account. Demonstration rule sets can
 * never be approved (database CHECK and this module).
 */
export class RuleSetLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuleSetLifecycleError';
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
    throw new RuleSetLifecycleError('ACTOR_NOT_ACTIVE', 'The acting user does not exist or is not active');
  }
  return actor;
}

async function protocolsFor(
  db: PrismaClient | Prisma.TransactionClient,
  def: ClinicalRuleSetDefinition,
): Promise<ProtocolForValidation[]> {
  return db.screeningProtocol.findMany({
    where: { code: def.protocolCode, version: { in: def.protocolVersions } },
    select: {
      code: true,
      version: true,
      category: true,
      isDemonstration: true,
      questions: { select: { code: true, answerType: true, options: true } },
    },
  });
}

function assertValid(problems: string[]) {
  if (problems.length > 0) {
    throw new RuleSetLifecycleError(
      'RULE_SET_INVALID',
      `Rule set does not fit its protocols:\n- ${problems.join('\n- ')}`,
    );
  }
}

/**
 * Imports a rule set as DRAFT. Re-importing identical content is a no-op; the same code and version
 * with different content is refused (create a new version instead).
 */
export async function importRuleSet(
  db: PrismaClient,
  def: ClinicalRuleSetDefinition,
  actorLoginId: string | null,
): Promise<{ id: string; created: boolean }> {
  const actor = actorLoginId ? await activeActor(db, actorLoginId) : null;
  if (!actor && !def.isDemonstration) {
    throw new RuleSetLifecycleError(
      'ACTOR_REQUIRED',
      'Only demonstration rule sets can be created without an actor',
    );
  }
  assertValid(validateAgainstProtocols(def, await protocolsFor(db, def)));
  return db.$transaction(async (tx) => {
    const existing = await tx.clinicalRuleSet.findUnique({
      where: { code_version: { code: def.code, version: def.version } },
    });
    if (existing) {
      if (ruleSetContentHash(ruleSetRowToDefinition(existing)) !== ruleSetContentHash(def)) {
        throw new RuleSetLifecycleError(
          'VERSION_EXISTS',
          `Rule set ${def.code} v${def.version} already exists with different content; create a new version`,
        );
      }
      return { id: existing.id, created: false };
    }
    const created = await tx.clinicalRuleSet.create({ data: ruleSetCreateInput(def, actor?.id ?? null) });
    await tx.clinicalRuleSetEvent.create({
      data: {
        ruleSetId: created.id,
        type: 'CREATED',
        toStatus: 'DRAFT',
        actorId: actor?.id ?? null,
        contentSha256: ruleSetContentHash(def),
      },
    });
    await recordAudit(tx, {
      actorUserId: actor?.id,
      action: 'clinical_rule_set.created',
      entityType: 'clinicalRuleSet',
      entityId: created.id,
      outcome: 'SUCCESS',
      details: {
        code: def.code,
        version: def.version,
        isDemonstration: def.isDemonstration,
        rules: def.rules.length,
        via: actor ? 'admin-script' : 'dev-seed',
      },
    });
    return { id: created.id, created: true };
  });
}

export interface RuleSetStatusChange {
  code: string;
  version: number;
  to: ProtocolStatus;
  actorLoginId: string;
  approvalReference?: string;
  effectiveFrom?: Date;
}

export async function changeRuleSetStatus(
  db: PrismaClient,
  change: RuleSetStatusChange,
  now: Date = new Date(),
): Promise<{ id: string; from: ProtocolStatus; to: ProtocolStatus; contentSha256: string | null }> {
  const actor = await activeActor(db, change.actorLoginId);
  if (change.to === 'APPROVED') {
    if (!(await hasPermissionAnywhere(db, actor.id, 'screening.review', now))) {
      throw new RuleSetLifecycleError(
        'APPROVER_NOT_AUTHORISED',
        'Only a user holding screening.review may record clinical approval (ASSUMPTION - programme to confirm the approver role)',
      );
    }
    if (!change.approvalReference?.trim()) {
      throw new RuleSetLifecycleError('APPROVAL_REFERENCE_REQUIRED', 'An approval reference is required');
    }
  }
  try {
    return await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "ClinicalRuleSet" WHERE code = ${change.code} AND version = ${change.version} FOR UPDATE`;
      if (locked.length === 0) {
        throw new RuleSetLifecycleError(
          'RULE_SET_NOT_FOUND',
          `Rule set ${change.code} v${change.version} not found`,
        );
      }
      const row = await tx.clinicalRuleSet.findUniqueOrThrow({ where: { id: locked[0]!.id } });
      const from = row.status;
      if (!ALLOWED[from].includes(change.to)) {
        throw new RuleSetLifecycleError(
          'INVALID_TRANSITION',
          `Cannot change status from ${from} to ${change.to}`,
        );
      }
      if (row.isDemonstration && ['APPROVED', 'ACTIVE', 'RETIRED'].includes(change.to)) {
        throw new RuleSetLifecycleError(
          'DEMONSTRATION_NOT_APPROVABLE',
          'Demonstration rules can never be approved or made operational',
        );
      }
      const def = ruleSetRowToDefinition(row); // throws on content that is not a valid rule set
      const currentHash = ruleSetContentHash(def);
      if (from !== 'DRAFT' && change.to !== 'DRAFT' && currentHash !== row.contentSha256) {
        throw new RuleSetLifecycleError(
          'CONTENT_CHANGED',
          'Stored content no longer matches the reviewed hash; investigate before continuing',
        );
      }
      if (change.to === 'IN_REVIEW' || change.to === 'APPROVED' || change.to === 'ACTIVE') {
        assertValid(validateAgainstProtocols(def, await protocolsFor(tx, def)));
      }

      const data: Prisma.ClinicalRuleSetUpdateInput = { status: change.to };
      if (change.to === 'IN_REVIEW') data.contentSha256 = currentHash;
      if (change.to === 'DRAFT') data.contentSha256 = null;
      if (change.to === 'APPROVED') {
        data.approvedBy = { connect: { id: actor.id } };
        data.approvedAt = now;
        data.approvalReference = change.approvalReference!.trim();
      }
      if (change.to === 'ACTIVE') data.effectiveFrom = change.effectiveFrom ?? now;
      if (change.to === 'RETIRED') data.retiredAt = now;

      const updated = await tx.clinicalRuleSet.update({ where: { id: row.id }, data });
      await tx.clinicalRuleSetEvent.create({
        data: {
          ruleSetId: row.id,
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
        action: 'clinical_rule_set.status_changed',
        entityType: 'clinicalRuleSet',
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
      (error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError) &&
      error.message.includes('clinical_rule_set_one_active_per_band')
    ) {
      throw new RuleSetLifecycleError(
        'ACTIVE_OVERLAP',
        'Another ACTIVE rule set for this category and protocol already covers part of this age band; retire it first',
      );
    }
    throw error;
  }
}
