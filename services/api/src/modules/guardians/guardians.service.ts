import type {
  addGuardianLinkRequestSchema,
  GuardianDetailResponse,
  GuardianLinkListResponse,
  GuardianLinkResponse,
  updateGuardianLinkRequestSchema,
  updateGuardianRequestSchema,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { AppError } from '../../utils/AppError';
import { runIdempotent } from '../../utils/idempotency';
import type { PiiCrypto } from '../../utils/piiCrypto';
import {
  assertInScopeOrDeny,
  childScopeWhere,
  denyAsNotFound,
  findChildOrDeny,
  type AccessContext,
} from '../access-control/accessScope';
import { recordAudit } from '../audit/audit.service';
import { guardianLinkOrder, guardianLinkSelect, toGuardianLink } from '../children/childDto';
import { staleRecord } from '../children/children.service';
import {
  checkGuardianLinks,
  clearPrimaryContact,
  createGuardianLinks,
  lockChildRow,
  type TxContext,
} from './guardianLinking';

type AddLinkBody = z.output<typeof addGuardianLinkRequestSchema>;
type UpdateLinkBody = z.output<typeof updateGuardianLinkRequestSchema>;
type UpdateGuardianBody = z.output<typeof updateGuardianRequestSchema>;

const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

export interface GuardiansServiceDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
}

export function createGuardiansService({ db, pii }: GuardiansServiceDependencies) {
  const txContext = (ctx: AccessContext): TxContext => ({ ...ctx, at: ctx.at ?? new Date(), auditDb: db });

  async function loadLink(linkId: string): Promise<GuardianLinkResponse> {
    const row = await db.childGuardian.findUniqueOrThrow({
      where: { id: linkId },
      select: guardianLinkSelect,
    });
    return { link: toGuardianLink(row, pii) };
  }

  /**
   * Loads a link only through its child (whole chain verified): the child must be accessible
   * with `permission` and the link must belong to THAT child. A link id from another child is a
   * 404 (audited), never a cross-child edit.
   */
  async function findActiveLinkOrDeny(
    tx: Prisma.TransactionClient | PrismaClient,
    ctx: TxContext,
    childId: string,
    linkId: string,
  ) {
    const link = await tx.childGuardian.findFirst({
      where: { id: linkId, childId, endedAt: null },
      select: {
        id: true,
        guardianId: true,
        relationship: true,
        isPrimaryContact: true,
        canGiveConsent: true,
      },
    });
    if (link) return link;
    const exists = (await tx.childGuardian.count({ where: { id: linkId } })) > 0;
    throw await denyAsNotFound(
      tx,
      ctx,
      'childGuardian',
      linkId,
      'child.update',
      exists,
      'Guardian link not found',
    );
  }

  async function loadGuardianDetail(ctx: TxContext, guardianId: string): Promise<GuardianDetailResponse> {
    const row = await db.guardian.findUniqueOrThrow({
      where: { id: guardianId },
      select: {
        id: true,
        fullName: true,
        phoneEncrypted: true,
        preferredLanguage: true,
        updatedAt: true,
        // Only links to children the caller may read: other children of the household stay
        // invisible (not even counted).
        children: {
          where: { endedAt: null, child: childScopeWhere(ctx.userId, 'child.read', ctx.at) },
          select: {
            id: true,
            relationship: true,
            isPrimaryContact: true,
            canGiveConsent: true,
            child: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return {
      guardian: {
        id: row.id,
        fullName: row.fullName,
        phone: row.phoneEncrypted ? pii.decryptPhone(row.phoneEncrypted, row.id) : null,
        preferredLanguage: row.preferredLanguage,
        updatedAt: row.updatedAt.toISOString(),
        children: row.children.map((link) => ({
          childId: link.child.id,
          childName: link.child.fullName,
          relationshipId: link.id,
          relationship: link.relationship,
          isPrimaryContact: link.isPrimaryContact,
          canGiveConsent: link.canGiveConsent,
        })),
      },
    };
  }

  return {
    /** Links of an accessible child. Ended links only with includeEnded (history). */
    async listLinks(
      ctx: AccessContext,
      childId: string,
      includeEnded: boolean,
    ): Promise<GuardianLinkListResponse> {
      await findChildOrDeny(db, ctx, childId, 'child.read');
      const rows = await db.childGuardian.findMany({
        where: { childId, guardian: { deletedAt: null }, ...(includeEnded ? {} : { endedAt: null }) },
        select: guardianLinkSelect,
        orderBy: [{ endedAt: { sort: 'desc', nulls: 'first' } }, ...guardianLinkOrder],
      });
      return { items: rows.map((row) => toGuardianLink(row, pii)) };
    },

    /** Links an existing in-scope guardian (e.g. a sibling's mother) or a new guardian. */
    async addLink(
      ctx: AccessContext,
      childId: string,
      body: AddLinkBody,
    ): Promise<{ result: GuardianLinkResponse; replayed: boolean }> {
      const tctx = txContext(ctx);
      const { clientOperationId, ...link } = body;
      const outcome = await runIdempotent(
        db,
        {
          userId: ctx.userId,
          clientOperationId,
          operationType: 'child_guardian.create',
          entityType: 'childGuardian',
          request: { childId, ...body },
        },
        async (tx) => {
          const child = await findChildOrDeny(tx, tctx, childId, 'child.update');
          await lockChildRow(tx, childId);
          await checkGuardianLinks(tx, tctx, childId, [link], 'child.update', pii);
          const [linkId] = await createGuardianLinks(tx, tctx, child, [link], pii);
          return linkId!;
        },
      );
      if (outcome.replayed) {
        await findChildOrDeny(db, ctx, childId, 'child.read');
        const owner = await db.childGuardian.findUnique({
          where: { id: outcome.entityId },
          select: { childId: true },
        });
        if (owner?.childId !== childId) {
          throw AppError.conflict(
            'IDEMPOTENCY_KEY_REUSED',
            'This submission id was already used for a different request.',
          );
        }
      }
      return { result: await loadLink(outcome.entityId), replayed: outcome.replayed };
    },

    /** Changes relationship, primary contact or consent authority of a current link. */
    async updateLink(
      ctx: AccessContext,
      childId: string,
      linkId: string,
      body: UpdateLinkBody,
    ): Promise<GuardianLinkResponse> {
      const tctx = txContext(ctx);
      await db.$transaction(async (tx) => {
        const child = await findChildOrDeny(tx, tctx, childId, 'child.update');
        await lockChildRow(tx, childId);
        const link = await findActiveLinkOrDeny(tx, tctx, childId, linkId);

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const field of ['relationship', 'isPrimaryContact', 'canGiveConsent'] as const) {
          if (body[field] !== undefined && body[field] !== link[field]) {
            changes[field] = { from: link[field], to: body[field] };
          }
        }
        if (Object.keys(changes).length === 0) return;

        if (body.isPrimaryContact === true) await clearPrimaryContact(tx, tctx, child, linkId);
        await tx.childGuardian.update({
          where: { id: linkId },
          data: {
            ...(body.relationship !== undefined && { relationship: body.relationship }),
            ...(body.isPrimaryContact !== undefined && { isPrimaryContact: body.isPrimaryContact }),
            ...(body.canGiveConsent !== undefined && { canGiveConsent: body.canGiveConsent }),
          },
        });
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: 'child_guardian.updated',
          entityType: 'childGuardian',
          entityId: linkId,
          areaId: child.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          // Enum and boolean values only.
          details: { childId, guardianId: link.guardianId, changes } as Prisma.InputJsonValue,
        });
      }, TX_OPTIONS);
      return loadLink(linkId);
    },

    /**
     * Ends a link (decision: history is kept; the row is never deleted). The last current
     * guardian of a child cannot be removed - link the correct guardian first.
     */
    async endLink(
      ctx: AccessContext,
      childId: string,
      linkId: string,
      reason: string,
    ): Promise<GuardianLinkResponse> {
      const tctx = txContext(ctx);
      await db.$transaction(async (tx) => {
        const child = await findChildOrDeny(tx, tctx, childId, 'child.update');
        await lockChildRow(tx, childId);
        const link = await findActiveLinkOrDeny(tx, tctx, childId, linkId);
        const active = await tx.childGuardian.count({ where: { childId, endedAt: null } });
        if (active <= 1) {
          throw AppError.conflict(
            'LAST_GUARDIAN',
            'A child must keep at least one guardian. Add the correct guardian first, then remove this one.',
          );
        }
        await tx.childGuardian.update({
          where: { id: linkId },
          data: { endedAt: tctx.at, endedById: ctx.userId, endReason: reason },
        });
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: 'child_guardian.ended',
          entityType: 'childGuardian',
          entityId: linkId,
          areaId: child.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          // The reason text is free text and could contain personal data: not copied to the audit.
          details: { childId, guardianId: link.guardianId, wasPrimaryContact: link.isPrimaryContact },
        });
      }, TX_OPTIONS);
      return loadLink(linkId);
    },

    /**
     * Guardian profile with the full phone number (audited view). Visible only through a child
     * the caller may read.
     */
    async get(ctx: AccessContext, guardianId: string): Promise<GuardianDetailResponse> {
      const tctx = txContext(ctx);
      await assertInScopeOrDeny(db, tctx, 'guardian', guardianId, 'child.read');
      const detail = await loadGuardianDetail(tctx, guardianId);
      await recordAudit(db, {
        actorUserId: ctx.userId,
        action: 'guardian.viewed',
        entityType: 'guardian',
        entityId: guardianId,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
        details: { phoneRevealed: detail.guardian.phone !== null },
      });
      return detail;
    },

    /** Name, phone (null removes it) and language. Optimistic concurrency (decision R). */
    async update(
      ctx: AccessContext,
      guardianId: string,
      body: UpdateGuardianBody,
    ): Promise<GuardianDetailResponse> {
      const tctx = txContext(ctx);
      await assertInScopeOrDeny(db, tctx, 'guardian', guardianId, 'child.update');
      const current = await db.guardian.findUniqueOrThrow({
        where: { id: guardianId },
        select: { fullName: true, phoneLookupHash: true, preferredLanguage: true, updatedAt: true },
      });
      if (current.updatedAt.getTime() !== new Date(body.expectedUpdatedAt).getTime()) throw staleRecord();

      const data: Prisma.GuardianUpdateManyMutationInput = {};
      const changed: string[] = [];
      if (body.fullName !== undefined && body.fullName !== current.fullName) {
        data.fullName = body.fullName;
        changed.push('fullName');
      }
      if (body.preferredLanguage !== undefined && body.preferredLanguage !== current.preferredLanguage) {
        data.preferredLanguage = body.preferredLanguage;
        changed.push('preferredLanguage');
      }
      if (body.phone === null && current.phoneLookupHash !== null) {
        data.phoneEncrypted = null;
        data.phoneLookupHash = null;
        changed.push('phoneRemoved');
      } else if (typeof body.phone === 'string') {
        const hash = pii.phoneLookupHash(body.phone);
        if (hash !== current.phoneLookupHash) {
          data.phoneEncrypted = pii.encryptPhone(body.phone, guardianId);
          data.phoneLookupHash = hash;
          changed.push('phone');
        }
      }
      // Step 8 (PP14): once a parent verified this number by code and activated an account, only
      // the parent can change it (code sent to the new number). Workers cannot.
      if (changed.includes('phone') || changed.includes('phoneRemoved')) {
        const account = await db.parentAccount.findUnique({
          where: { guardianId },
          select: { status: true },
        });
        if (account && account.status !== 'DISABLED') {
          throw AppError.conflict(
            'PHONE_VERIFIED_BY_PARENT',
            'This number was verified by the parent for the Parent Portal. Only the parent can change it.',
          );
        }
      }

      if (changed.length > 0) {
        await db.$transaction(async (tx) => {
          const { count } = await tx.guardian.updateMany({
            where: { id: guardianId, updatedAt: current.updatedAt, deletedAt: null },
            data,
          });
          if (count === 0) throw staleRecord();
          await recordAudit(tx, {
            actorUserId: ctx.userId,
            action: 'guardian.updated',
            entityType: 'guardian',
            entityId: guardianId,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            // Field names only - never names or numbers.
            details: { fields: changed },
          });
        }, TX_OPTIONS);
      }
      return loadGuardianDetail(tctx, guardianId);
    },
  };
}
