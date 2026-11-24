import { randomUUID } from 'node:crypto';
import type {
  AmendmentQueueQuery,
  AmendmentQueueResponse,
  CreateAmendmentRequest,
  ResponseValue,
  ReviewAmendmentRequest,
  ScreeningMeasurementType,
  ScreeningSessionResponse,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { runIdempotent } from '../../utils/idempotency';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { denyAsNotFound, scopedWhere, type AccessContext } from '../access-control/accessScope';
import { recordAudit } from '../audit/audit.service';
import { generateResultRun } from '../clinical-rules/resultGeneration';
import { fromDbDate } from '../children/birthDate';
import {
  currentState,
  sealMeasurement,
  sealNotes,
  sealResponse,
  type MeasurementRecord,
  type ResponseRecord,
} from './amendmentOverlay';
import { formatDecimal, parseDecimal, validateMeasurement } from './measurementRules';
import { responseColumns } from './responseRules';
import type { ScreeningPolicySettings } from './protocolSelection';
import { amendmentAccess, loadSessionDetail } from './sessionDetail';
import { detailInclude } from './sessionDto';
import { sessionTextSealer } from './sensitiveText';

export interface AmendmentsServiceDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  /** Step 7: which rule sets result generation may use (drafts only outside production). */
  screeningPolicy: ScreeningPolicySettings;
}

const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const normalDecimal = (value: string) => formatDecimal(parseDecimal(value)!);

/**
 * Amendments of COMPLETED screenings (Step 6G; docs/step-6/amendment-design.md, decisions G1-G12).
 * The completed screening rows are never changed: each amendment is a new version (sequence 1, 2,
 * ...) whose changes record the exact old and new values. All of it happens in ONE transaction:
 *  1. the session must be in the caller's scope (screening.conduct or screening.review) - else 404;
 *  2. the session row is locked, so concurrent amendments are serialised;
 *  3. it must be COMPLETED; the caller must be allowed (medical officer, or the conductor within
 *     7 x 24 h) - else 403, audited;
 *  4. `expectedSequence` must equal the latest sequence - else 409 (never a silent overwrite);
 *  5. every change is validated like a normal answer / measurement, old values are taken from the
 *     CURRENT version, unchanged items are refused;
 *  6. amendment, changes, referral reassessment flags and the audit row are written together.
 * Consent is not re-checked (decision G8): an amendment corrects an existing record.
 */
export function createAmendmentsService({ db, pii, screeningPolicy }: AmendmentsServiceDependencies) {
  const at = (ctx: AccessContext) => ctx.at ?? new Date();

  async function assertInScope(
    ctx: AccessContext,
    sessionId: string,
    permissions: readonly ('screening.conduct' | 'screening.review')[],
  ) {
    for (const permission of permissions) {
      const count = await db.screeningSession.count({
        where: { id: sessionId, ...scopedWhere.screeningSession(ctx.userId, permission, at(ctx)) },
      });
      if (count > 0) return;
    }
    const exists = (await db.screeningSession.count({ where: { id: sessionId } })) > 0;
    throw await denyAsNotFound(
      db,
      ctx,
      'screeningSession',
      sessionId,
      permissions[0]!,
      exists,
      'Screening not found',
    );
  }

  async function auditDenied(ctx: AccessContext, sessionId: string, areaId: string, reason: string) {
    await recordAudit(db, {
      actorUserId: ctx.userId,
      action: 'screening.amendment_denied',
      entityType: 'screeningSession',
      entityId: sessionId,
      areaId,
      outcome: 'DENIED',
      requestId: ctx.requestId,
      details: { reason },
    });
  }

  return {
    async create(
      ctx: AccessContext,
      sessionId: string,
      body: CreateAmendmentRequest,
    ): Promise<{ result: ScreeningSessionResponse; replayed: boolean }> {
      await assertInScope(ctx, sessionId, ['screening.conduct', 'screening.review']);
      const now = at(ctx);
      const outcome = await runIdempotent(
        db,
        {
          userId: ctx.userId,
          clientOperationId: body.clientOperationId,
          operationType: 'screening.amend',
          entityType: 'screeningAmendment',
          request: { sessionId, ...body },
        },
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "ScreeningSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
          const row = await tx.screeningSession.findUniqueOrThrow({
            where: { id: sessionId },
            include: detailInclude,
          });
          if (row.status !== 'COMPLETED') {
            throw AppError.conflict(
              'SESSION_NOT_COMPLETED',
              row.status === 'CANCELLED'
                ? 'A cancelled screening cannot be amended.'
                : 'This screening is not completed yet: change it directly instead of amending it.',
              { status: row.status },
            );
          }
          const access = await amendmentAccess(tx, ctx, row);
          if (!access.canAmend || !access.amendBasis) {
            const reason = row.conductedById === ctx.userId ? 'WINDOW_EXPIRED' : 'NOT_PERMITTED';
            await auditDenied(ctx, sessionId, row.areaId, reason);
            throw AppError.forbidden(
              'AMENDMENT_NOT_ALLOWED',
              reason === 'WINDOW_EXPIRED'
                ? 'The 7-day period for amending this screening has ended. Ask a medical officer.'
                : 'You are not allowed to amend this screening.',
            );
          }
          const currentSequence = row.amendments.length;
          if (body.expectedSequence !== currentSequence) {
            throw AppError.conflict(
              'AMENDMENT_CONFLICT',
              'This screening was amended by someone else. Reload it before amending again.',
              { currentSequence },
            );
          }

          const text = sessionTextSealer(pii, sessionId);
          const state = currentState(row, text);
          const amendmentId = randomUUID();
          const seen = new Set<string>();
          const prepared: Prisma.ScreeningAmendmentChangeCreateManyInput[] = [];
          const unchanged = (where: string) =>
            AppError.unprocessable(
              'AMENDMENT_UNCHANGED',
              'A change has the same value as the current version.',
              {
                item: where,
              },
            );

          for (const change of body.changes) {
            const changeId = randomUUID();
            if (change.kind === 'RESPONSE' || change.kind === 'CATEGORY_NOTES') {
              const cat = row.categories.find((c) => c.category === change.category);
              if (!cat) {
                throw AppError.unprocessable(
                  'CATEGORY_NOT_IN_SCREENING',
                  'This area was not screened in this screening.',
                  {
                    category: change.category,
                  },
                );
              }
              if (change.kind === 'CATEGORY_NOTES') {
                const key = `notes:${cat.id}`;
                if (seen.has(key))
                  throw AppError.unprocessable('DUPLICATE_CHANGE', 'An item is changed twice.');
                seen.add(key);
                const old = { notes: state.categoryNotes.get(cat.id)!.notes };
                const next = { notes: change.notes };
                if (same(old, next)) throw unchanged(change.category);
                prepared.push({
                  id: changeId,
                  amendmentId,
                  kind: 'CATEGORY_NOTES',
                  sessionCategoryId: cat.id,
                  oldValue: sealNotes(text, changeId, 'old', old),
                  newValue: sealNotes(text, changeId, 'new', next),
                  clinicallySignificant: false,
                });
                continue;
              }
              const question = cat.protocol.questions.find((q) => q.id === change.questionId);
              if (!question) {
                throw AppError.unprocessable(
                  'QUESTION_NOT_IN_PROTOCOL',
                  'A question does not belong to the screening content used for this area.',
                  { questionId: change.questionId },
                );
              }
              const key = `q:${question.id}`;
              if (seen.has(key))
                throw AppError.unprocessable('DUPLICATE_CHANGE', 'An item is changed twice.');
              seen.add(key);
              // Same validation as a normal answer (type, options, ranges, decimals).
              const columns = responseColumns(question, change);
              const value: ResponseValue | null =
                change.status !== 'ANSWERED'
                  ? null
                  : question.answerType === 'TEXT'
                    ? columns.valueText
                    : (change.value ?? null);
              const next: ResponseRecord = {
                status: change.status,
                source: change.source,
                value,
                notAssessedReason: change.notAssessedReason ?? null,
                notes: change.notes ?? null,
              };
              const old = state.responses.get(cat.id)?.get(question.id)?.record ?? null;
              if (old && same(old, next)) throw unchanged(question.code);
              prepared.push({
                id: changeId,
                amendmentId,
                kind: 'RESPONSE',
                sessionCategoryId: cat.id,
                questionId: question.id,
                oldValue: old ? sealResponse(text, changeId, 'old', old, question) : undefined,
                newValue: sealResponse(text, changeId, 'new', next, question),
                // Decision G5: the answer's state or value changed.
                clinicallySignificant: !old || old.status !== next.status || !same(old.value, next.value),
              });
              continue;
            }

            // MEASUREMENT
            const m = row.measurements.find((x) => x.id === change.measurementId);
            if (!m) {
              throw AppError.unprocessable(
                'MEASUREMENT_NOT_IN_SCREENING',
                'This measurement is not part of this screening.',
              );
            }
            if (m.supersededBy) {
              throw AppError.conflict(
                'MEASUREMENT_ALREADY_CORRECTED',
                'This measurement was corrected. Amend the latest value instead.',
              );
            }
            const key = `m:${m.id}`;
            if (seen.has(key)) throw AppError.unprocessable('DUPLICATE_CHANGE', 'An item is changed twice.');
            seen.add(key);
            const birth = fromDbDate(row.dateOfBirthAtStart);
            validateMeasurement({
              type: m.type as ScreeningMeasurementType,
              value: change.value,
              unit: change.unit,
              measuredAt: new Date(change.measuredAt),
              now,
              notBefore: new Date(Date.UTC(birth.year, birth.month - 1, birth.day) - IST_OFFSET_MS),
            });
            const old = state.measurements.get(m.id)!.record;
            const next: MeasurementRecord = {
              value: normalDecimal(change.value),
              unit: change.unit,
              source: change.source,
              quality: change.quality,
              measuredAt: new Date(change.measuredAt).toISOString(),
              notes: change.notes ?? null,
            };
            const oldNormal = { ...old, value: normalDecimal(old.value) };
            if (same(oldNormal, next)) throw unchanged(m.id);
            prepared.push({
              id: changeId,
              amendmentId,
              kind: 'MEASUREMENT',
              measurementId: m.id,
              oldValue: sealMeasurement(text, changeId, 'old', old),
              newValue: sealMeasurement(text, changeId, 'new', next),
              clinicallySignificant: !same({ ...oldNormal, notes: null }, { ...next, notes: null }),
            });
          }

          const significant = prepared.some((c) => c.clinicallySignificant);
          await tx.screeningAmendment.create({
            data: {
              id: amendmentId,
              sessionId,
              sequence: currentSequence + 1,
              amendedById: ctx.userId,
              amendedAt: now,
              basis: access.amendBasis,
              reason: text.seal({ kind: 'amendment', amendmentId, field: 'reason' }, body.reason)!,
              clinicallySignificant: significant,
              reviewStatus: significant ? 'PENDING' : 'NOT_REQUIRED',
              clientOperationId: body.clientOperationId,
            },
          });
          await tx.screeningAmendmentChange.createMany({ data: prepared });
          // Decision G9: every referral made from this screening is flagged; the referral is unchanged.
          const referrals = await tx.referral.findMany({
            where: { sessionId },
            select: { id: true, status: true },
          });
          if (referrals.length > 0) {
            await tx.screeningAmendmentReferralImpact.createMany({
              data: referrals.map((r) => ({
                amendmentId,
                referralId: r.id,
                referralStatusAtAmendment: r.status,
              })),
            });
          }
          await recordAudit(tx, {
            actorUserId: ctx.userId,
            action: 'screening.amended',
            entityType: 'screeningSession',
            entityId: sessionId,
            areaId: row.areaId,
            outcome: 'SUCCESS',
            requestId: ctx.requestId,
            details: {
              amendmentId,
              sequence: currentSequence + 1,
              basis: access.amendBasis,
              changes: prepared.length,
              kinds: [...new Set(prepared.map((c) => c.kind))],
              clinicallySignificant: significant,
              referralsFlagged: referrals.length,
            },
          });
          // Step 7 decision F: the new screening version gets its own result run (the previous
          // run is marked superseded, never changed).
          await generateResultRun(
            tx,
            { pii, screeningPolicy },
            { sessionId, generatedById: null, now, requestId: ctx.requestId },
          );
          return amendmentId;
        },
      );
      return { result: await loadSessionDetail(db, pii, ctx, sessionId), replayed: outcome.replayed };
    },

    /** Medical-officer review of a PENDING amendment (decision G7: acknowledge, never roll back). */
    async review(
      ctx: AccessContext,
      sessionId: string,
      amendmentId: string,
      body: ReviewAmendmentRequest,
    ): Promise<ScreeningSessionResponse> {
      await assertInScope(ctx, sessionId, ['screening.review']);
      const now = at(ctx);
      await db.$transaction(async (tx) => {
        const amendment = await tx.screeningAmendment.findFirst({ where: { id: amendmentId, sessionId } });
        if (!amendment) throw AppError.notFound('Amendment not found');
        const updated = await tx.screeningAmendment.updateMany({
          where: { id: amendmentId, sessionId, reviewStatus: 'PENDING' },
          data: {
            reviewStatus: 'REVIEWED',
            reviewedById: ctx.userId,
            reviewedAt: now,
            reviewNotes: sessionTextSealer(pii, sessionId).seal(
              { kind: 'amendment', amendmentId, field: 'reviewNotes' },
              body.notes,
            ),
          },
        });
        if (updated.count === 0) {
          throw AppError.conflict(
            'AMENDMENT_NOT_PENDING',
            'This amendment does not need review, or was already reviewed.',
            {
              reviewStatus: amendment.reviewStatus,
            },
          );
        }
        const session = await tx.screeningSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { areaId: true },
        });
        await recordAudit(tx, {
          actorUserId: ctx.userId,
          action: 'screening.amendment_reviewed',
          entityType: 'screeningSession',
          entityId: sessionId,
          areaId: session.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
          details: {
            amendmentId,
            sequence: amendment.sequence,
            selfReviewed: amendment.amendedById === ctx.userId,
          },
        });
      }, TX_OPTIONS);
      return loadSessionDetail(db, pii, ctx, sessionId);
    },

    /** Pending clinically significant amendments in the reviewer's areas, oldest first. */
    async queue(ctx: AccessContext, query: AmendmentQueueQuery): Promise<AmendmentQueueResponse> {
      const where: Prisma.ScreeningAmendmentWhereInput = {
        reviewStatus: 'PENDING',
        session: scopedWhere.screeningSession(ctx.userId, 'screening.review', at(ctx)),
      };
      const [total, rows] = await Promise.all([
        db.screeningAmendment.count({ where }),
        db.screeningAmendment.findMany({
          where,
          include: {
            session: { select: { childId: true, child: { select: { fullName: true } } } },
            amendedBy: { select: { displayName: true } },
            _count: { select: { changes: true } },
          },
          orderBy: [{ amendedAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return {
        items: rows.map((a) => ({
          amendmentId: a.id,
          sessionId: a.sessionId,
          childId: a.session.childId,
          childName: a.session.child.fullName,
          sequence: a.sequence,
          amendedAt: a.amendedAt.toISOString(),
          amendedByName: a.amendedBy.displayName,
          basis: a.basis,
          changeCount: a._count.changes,
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },
  };
}
