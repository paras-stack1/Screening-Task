import type {
  ChildConsentsResponse,
  ConsentNotice,
  ConsentNoticeQuery,
  ConsentPurpose,
  ConsentRecord,
  ConsentRecordResponse,
  RecordConsentRequest,
  WithdrawConsentRequest,
} from '@balswasthya/shared-contracts';
import { CONSENT_PURPOSES } from '@balswasthya/shared-contracts';
import type { ApprovalStatus, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { runIdempotent } from '../../utils/idempotency';
import { logger } from '../../utils/logger';
import { denyAsNotFound, findChildOrDeny, type AccessContext } from '../access-control/accessScope';
import { recordAudit } from '../audit/audit.service';
import { findNoticeText, noticeHash, OPTIONAL_PURPOSES } from './consentNotices';
import {
  evaluateAllPurposes,
  evaluateConsents,
  LATEST_FIRST,
  type ConsentPolicySettings,
} from './consentPolicy';

const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;

const recordSelect = {
  id: true,
  purpose: true,
  decision: true,
  method: true,
  evidenceReference: true,
  recordedAt: true,
  withdrawnAt: true,
  withdrawalMethod: true,
  withdrawalReason: true,
  guardian: { select: { id: true, fullName: true } },
  template: { select: { version: true, languageCode: true, status: true } },
  recordedBy: { select: { displayName: true } },
  withdrawnBy: { select: { displayName: true } },
} satisfies Prisma.ConsentSelect;

function toRecord(row: Prisma.ConsentGetPayload<{ select: typeof recordSelect }>): ConsentRecord {
  return {
    id: row.id,
    purpose: row.purpose,
    decision: row.decision,
    method: row.method,
    noticeVersion: row.template.version,
    noticeLanguage: row.template.languageCode,
    noticeWasPlaceholder:
      findNoticeText(row.purpose, row.template.version, row.template.languageCode)?.isPlaceholder ?? true,
    evidenceReference: row.evidenceReference,
    guardianId: row.guardian.id,
    guardianName: row.guardian.fullName,
    recordedAt: row.recordedAt.toISOString(),
    recordedByName: row.recordedBy.displayName,
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    withdrawnByName: row.withdrawnBy?.displayName ?? null,
    withdrawalMethod: row.withdrawalMethod,
    withdrawalReason: row.withdrawalReason,
  };
}

export interface ConsentServiceDependencies {
  db: PrismaClient;
  consentPolicy: ConsentPolicySettings;
}

export function createConsentService({ db, consentPolicy }: ConsentServiceDependencies) {
  const usableStatuses = (): ApprovalStatus[] =>
    consentPolicy.allowDraftNotices ? ['APPROVED', 'DRAFT'] : ['APPROVED'];

  /** Highest usable (not retired; approved, or draft outside production) version. */
  async function currentTemplate(
    tx: Prisma.TransactionClient | PrismaClient,
    purpose: ConsentPurpose,
    language: string,
  ) {
    return tx.consentTemplate.findFirst({
      where: { purpose, languageCode: language, status: { in: usableStatuses() } },
      orderBy: { version: 'desc' },
    });
  }

  /** Serialises decisions for one (child, purpose), so "latest" is well defined under concurrency. */
  async function lockPurpose(tx: Prisma.TransactionClient, childId: string, purpose: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consent:${childId}:${purpose}`}, 0))`;
  }

  /** The guardian must be CURRENTLY linked to the child AND marked as able to give consent. */
  async function assertGuardianMayDecide(
    tx: Prisma.TransactionClient,
    ctx: AccessContext,
    child: { id: string; areaId: string },
    guardianId: string,
    action: string,
  ) {
    const link = await tx.childGuardian.findFirst({
      where: { childId: child.id, guardianId, endedAt: null, guardian: { deletedAt: null } },
      select: { canGiveConsent: true },
    });
    const problem = !link ? 'GUARDIAN_NOT_LINKED' : !link.canGiveConsent ? 'GUARDIAN_NOT_AUTHORISED' : null;
    if (!problem) return;
    await recordAudit(db, {
      actorUserId: ctx.userId,
      action,
      entityType: 'child',
      entityId: child.id,
      areaId: child.areaId,
      outcome: 'DENIED',
      requestId: ctx.requestId,
      details: { reason: problem, guardianId },
    });
    throw problem === 'GUARDIAN_NOT_LINKED'
      ? AppError.unprocessable('GUARDIAN_NOT_LINKED', 'This guardian is not currently linked to the child.')
      : AppError.unprocessable(
          'GUARDIAN_NOT_AUTHORISED',
          'This guardian is not marked as able to give consent for the child.',
        );
  }

  async function loadRecordResponse(consentId: string): Promise<ConsentRecordResponse> {
    const row = await db.consent.findUniqueOrThrow({
      where: { id: consentId },
      select: { ...recordSelect, childId: true },
    });
    const [status] = await evaluateConsents(db, row.childId, [row.purpose], consentPolicy);
    return { consent: toRecord(row), status: status! };
  }

  return {
    /**
     * Current notice per purpose in one language. A notice whose stored hash does not match the
     * served text is withheld (and logged): a guardian must never be shown unverified wording.
     */
    async notices(query: ConsentNoticeQuery): Promise<{ items: ConsentNotice[] }> {
      const purposes = query.purpose ? [query.purpose] : CONSENT_PURPOSES;
      const items: ConsentNotice[] = [];
      for (const purpose of purposes) {
        const template = await currentTemplate(db, purpose, query.language);
        if (!template) continue;
        const text = findNoticeText(purpose, template.version, template.languageCode);
        if (!text || noticeHash(text) !== template.textSha256) {
          logger.error('consent_notice_drift', {
            purpose,
            version: template.version,
            language: template.languageCode,
          });
          continue;
        }
        items.push({
          templateId: template.id,
          purpose,
          version: template.version,
          language: template.languageCode,
          title: text.title,
          body: text.body,
          optional: OPTIONAL_PURPOSES.has(purpose),
          isPlaceholder: text.isPlaceholder,
          approvalStatus: template.status,
        });
      }
      return { items };
    },

    /** Status for every purpose plus the full, append-only history (newest first). */
    async forChild(ctx: AccessContext, childId: string): Promise<ChildConsentsResponse> {
      const child = await findChildOrDeny(db, ctx, childId, 'child.read');
      const [statuses, rows] = await Promise.all([
        evaluateAllPurposes(db, childId, consentPolicy),
        db.consent.findMany({ where: { childId }, select: recordSelect, orderBy: LATEST_FIRST, take: 500 }),
      ]);
      await recordAudit(db, {
        actorUserId: ctx.userId,
        action: 'consent.history_viewed',
        entityType: 'child',
        entityId: childId,
        areaId: child.areaId,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
      });
      return { statuses, history: rows.map(toRecord) };
    },

    /**
     * Records one decision (GRANTED or REFUSED) by one authorised guardian for one purpose,
     * bound to the exact current notice version. Append-only; the server sets time and actor.
     */
    async record(
      ctx: AccessContext,
      childId: string,
      body: RecordConsentRequest,
    ): Promise<{ result: ConsentRecordResponse; replayed: boolean }> {
      const at = ctx.at ?? new Date();
      const tctx = { ...ctx, at, auditDb: db };
      const outcome = await runIdempotent(
        db,
        {
          userId: ctx.userId,
          clientOperationId: body.clientOperationId,
          operationType: 'consent.record',
          entityType: 'consent',
          request: { childId, ...body },
        },
        async (tx) => {
          const child = await findChildOrDeny(tx, tctx, childId, 'consent.record');
          await lockPurpose(tx, childId, body.purpose);
          await assertGuardianMayDecide(tx, ctx, child, body.guardianId, 'consent.record_denied');

          const template = await tx.consentTemplate.findUnique({ where: { id: body.templateId } });
          if (!template || template.purpose !== body.purpose) {
            throw AppError.unprocessable(
              'NOTICE_MISMATCH',
              'The notice does not belong to this consent purpose.',
            );
          }
          const current = await currentTemplate(tx, body.purpose, template.languageCode);
          if (!current || current.id !== template.id) {
            throw AppError.conflict(
              template.status === 'DRAFT' && !consentPolicy.allowDraftNotices
                ? 'NOTICE_NOT_APPROVED'
                : 'NOTICE_OUTDATED',
              'This notice is not the current approved version. Reload the notice and explain it again.',
            );
          }
          const text = findNoticeText(template.purpose, template.version, template.languageCode);
          if (!text || noticeHash(text) !== template.textSha256) {
            logger.error('consent_notice_drift', { purpose: template.purpose, version: template.version });
            throw new AppError(
              503,
              'CONSENT_NOTICE_UNAVAILABLE',
              'The consent notice is unavailable. Try again later.',
            );
          }

          const consent = await tx.consent.create({
            data: {
              childId,
              guardianId: body.guardianId,
              purpose: body.purpose,
              decision: body.decision,
              method: body.method,
              templateId: template.id,
              evidenceReference: body.evidenceReference ?? null,
              recordedById: ctx.userId,
              recordedAt: at,
            },
            select: { id: true },
          });
          await recordAudit(tx, {
            actorUserId: ctx.userId,
            action: body.decision === 'GRANTED' ? 'consent.granted' : 'consent.refused',
            entityType: 'consent',
            entityId: consent.id,
            areaId: child.areaId,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            details: {
              childId,
              guardianId: body.guardianId,
              purpose: body.purpose,
              method: body.method,
              templateId: template.id,
              noticeVersion: template.version,
              noticeLanguage: template.languageCode,
            },
          });
          return consent.id;
        },
      );
      if (outcome.replayed) {
        await findChildOrDeny(db, ctx, childId, 'consent.record');
        const owner = await db.consent.findUnique({
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
      return { result: await loadRecordResponse(outcome.entityId), replayed: outcome.replayed };
    },

    /**
     * Withdraws the CURRENT grant for its purpose (decision N): history is kept, only the
     * withdrawal fields are stamped once. Other purposes are not affected.
     */
    async withdraw(
      ctx: AccessContext,
      childId: string,
      consentId: string,
      body: WithdrawConsentRequest,
    ): Promise<ConsentRecordResponse> {
      const at = ctx.at ?? new Date();
      const tctx = { ...ctx, at, auditDb: db };
      await db.$transaction(async (tx) => {
        const child = await findChildOrDeny(tx, tctx, childId, 'consent.record');
        // Chain check: the consent must belong to THIS child.
        const target = await tx.consent.findFirst({
          where: { id: consentId, childId },
          select: { purpose: true },
        });
        if (!target) {
          const exists = (await tx.consent.count({ where: { id: consentId } })) > 0;
          throw await denyAsNotFound(
            tx,
            tctx,
            'consent',
            consentId,
            'consent.record',
            exists,
            'Consent not found',
          );
        }
        await lockPurpose(tx, childId, target.purpose);
        await assertGuardianMayDecide(tx, ctx, child, body.guardianId, 'consent.withdraw_denied');

        const consent = await tx.consent.findUniqueOrThrow({ where: { id: consentId } });
        if (consent.decision !== 'GRANTED') {
          throw AppError.conflict('NOT_WITHDRAWABLE', 'Only a granted consent can be withdrawn.');
        }
        if (consent.withdrawnAt) {
          throw AppError.conflict('ALREADY_WITHDRAWN', 'This consent has already been withdrawn.');
        }
        const latest = await tx.consent.findFirst({
          where: { childId, purpose: consent.purpose },
          orderBy: LATEST_FIRST,
          select: { id: true },
        });
        if (latest?.id !== consentId) {
          throw AppError.conflict(
            'NOT_CURRENT_CONSENT',
            'A newer decision exists for this purpose. Reload the consent history.',
          );
        }

        const { count } = await tx.consent.updateMany({
          where: { id: consentId, withdrawnAt: null, decision: 'GRANTED' },
          data: {
            withdrawnAt: at,
            withdrawnById: ctx.userId,
            withdrawalMethod: body.method,
            withdrawalReason: body.reason ?? null,
          },
        });
        if (count === 0)
          throw AppError.conflict('ALREADY_WITHDRAWN', 'This consent has already been withdrawn.');
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: 'consent.withdrawn',
          entityType: 'consent',
          entityId: consentId,
          areaId: child.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          // The withdrawal reason is free text: not copied into the audit log.
          details: {
            childId,
            purpose: consent.purpose,
            requestedByGuardianId: body.guardianId,
            grantedByGuardianId: consent.guardianId,
            method: body.method,
          },
        });
      }, TX_OPTIONS);
      return loadRecordResponse(consentId);
    },
  };
}
