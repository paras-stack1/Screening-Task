import {
  FOUR_D_CATEGORIES,
  formatCalendarDate,
  todayInIndia,
  type AddMeasurementRequest,
  type CancelSessionRequest,
  type CompleteSessionRequest,
  type CorrectMeasurementRequest,
  type FourDCategoryCode,
  type ResponseInput,
  type ScreeningDashboardSummary,
  type ScreeningHistoryQuery,
  type ScreeningListQuery,
  type ScreeningListResponse,
  type ScreeningSessionResponse,
  type StartCategoryRequest,
  type StartScreeningRequest,
  type UpdateCategoryRequest,
} from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient, type ScreeningSession } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { runIdempotent } from '../../utils/idempotency';
import { logger } from '../../utils/logger';
import {
  assertInScopeOrDeny,
  findChildOrDeny,
  scopedWhere,
  type AccessContext,
} from '../access-control/accessScope';
import { recordAudit, type AuditEntry } from '../audit/audit.service';
import { fromDbDate } from '../children/birthDate';
import { assertConsentPermits, type ConsentPolicySettings } from '../consent/consentPolicy';
import { validateMeasurement } from './measurementRules';
import { protocolContentHash, protocolRowToDefinition } from './protocolContent';
import { selectProtocol, type ScreeningPolicySettings } from './protocolSelection';
import { responseChanged, responseColumns } from './responseRules';
import { screeningAge } from './screeningAge';
import { detailInclude, summaryInclude, toSessionDetail, toSessionSummary } from './sessionDto';

export interface ScreeningsServiceDependencies {
  db: PrismaClient;
  consentPolicy: ConsentPolicySettings;
  screeningPolicy: ScreeningPolicySettings;
}

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const OPEN: ScreeningSession['status'][] = ['DRAFT', 'IN_PROGRESS'];

/** Result of one change inside a session transaction. */
interface SessionChange {
  /** Extra fields for the session row (status, completion...). `version` is always bumped. */
  patch?: Prisma.ScreeningSessionUncheckedUpdateInput;
  /** Audit events (identifiers and counts only - never answers, values or notes). */
  audit: Array<Omit<AuditEntry, 'actorUserId' | 'requestId' | 'entityType' | 'entityId' | 'outcome'>>;
}

interface WriteOptions {
  /** Version the client last saw. */
  expectedVersion: number;
  /** Cancellation does not need consent (it records that the screening stopped). */
  requireConsent?: boolean;
}

/**
 * Screening sessions (Step 6 stage 6C; decisions H, I, K, L, N, O, R, S).
 *
 * Every write runs the same guarded sequence in ONE transaction:
 *  1. the session must be in the caller's scope with screening.conduct (else 404 + audit, R11);
 *  2. the session row is locked (FOR UPDATE) so concurrent writes are serialised;
 *  3. only the worker who started it may change it (403 + audit, decision L);
 *  4. it must still be open (409 SESSION_FINAL) and at the version the client saw (409);
 *  5. SCREENING consent is re-checked at the point of use (decision R; 403 CONSENT_REQUIRED);
 *  6. the change is applied, the version bumped by one, and audit rows written in the same
 *     transaction (a failed change leaves no audit row and no partial data).
 * The database triggers enforce the same integrity rules again for every account.
 */
export function createScreeningsService({
  db,
  consentPolicy,
  screeningPolicy,
}: ScreeningsServiceDependencies) {
  const at = (ctx: AccessContext) => ctx.at ?? new Date();

  async function loadDetail(id: string, ctx: AccessContext): Promise<ScreeningSessionResponse> {
    const row = await db.screeningSession.findUniqueOrThrow({ where: { id }, include: detailInclude });
    return { session: toSessionDetail(row, ctx.userId) };
  }

  async function auditDenied(ctx: AccessContext, session: ScreeningSession, reason: string) {
    await recordAudit(db, {
      actorUserId: ctx.userId,
      action: 'screening.write_denied',
      entityType: 'screeningSession',
      entityId: session.id,
      areaId: session.areaId,
      outcome: 'DENIED',
      requestId: ctx.requestId,
      details: { reason },
    });
  }

  async function write(
    ctx: AccessContext,
    sessionId: string,
    options: WriteOptions,
    change: (tx: Tx, session: ScreeningSession) => Promise<SessionChange>,
  ): Promise<ScreeningSessionResponse> {
    await assertInScopeOrDeny(db, ctx, 'screeningSession', sessionId, 'screening.conduct');
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ScreeningSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const session = await tx.screeningSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (session.conductedById !== ctx.userId) {
        await auditDenied(ctx, session, 'NOT_SESSION_OWNER');
        throw AppError.forbidden(
          'NOT_SESSION_OWNER',
          'Only the worker who started this screening can change it.',
        );
      }
      if (!OPEN.includes(session.status)) {
        throw AppError.conflict(
          'SESSION_FINAL',
          `This screening is ${session.status.toLowerCase()} and cannot be changed.`,
          {
            status: session.status,
          },
        );
      }
      if (session.version !== options.expectedVersion) {
        throw AppError.conflict(
          'VERSION_CONFLICT',
          'This screening was changed elsewhere. Reload it before saving again.',
          { currentVersion: session.version },
        );
      }
      if (options.requireConsent !== false) {
        await assertConsentPermits(
          tx,
          { ...ctx, auditDb: db },
          session.childId,
          'SCREENING',
          'screening.conduct',
          consentPolicy,
        );
      }
      const result = await change(tx, session);
      await tx.screeningSession.update({
        where: { id: sessionId },
        data: { ...result.patch, version: { increment: 1 } },
      });
      for (const entry of result.audit) {
        await recordAudit(tx, {
          ...entry,
          actorUserId: ctx.userId,
          entityType: 'screeningSession',
          entityId: sessionId,
          areaId: session.areaId,
          outcome: 'SUCCESS',
          requestId: ctx.requestId,
        });
      }
    }, TX_OPTIONS);
    return loadDetail(sessionId, ctx);
  }

  /** First content moves a DRAFT session to IN_PROGRESS. */
  const startedPatch = (s: ScreeningSession): Prisma.ScreeningSessionUncheckedUpdateInput =>
    s.status === 'DRAFT' ? { status: 'IN_PROGRESS' } : {};

  async function categoryOf(tx: Tx, sessionId: string, category: FourDCategoryCode) {
    const row = await tx.screeningSessionCategory.findUnique({
      where: { sessionId_category: { sessionId, category } },
      include: { protocol: { include: { questions: true } } },
    });
    if (!row) {
      throw AppError.conflict('CATEGORY_NOT_STARTED', 'Start this screening category first.', { category });
    }
    return row;
  }

  async function usableCandidates(tx: Tx, category: FourDCategoryCode, ageInDays: number) {
    return tx.screeningProtocol.findMany({
      where: {
        category,
        status: { in: screeningPolicy.allowDraftProtocols ? ['ACTIVE', 'DRAFT'] : ['ACTIVE'] },
        ageMinDays: { lte: ageInDays },
        ageMaxDays: { gte: ageInDays },
      },
    });
  }

  /** Start of a calendar date in India, as an instant. */
  const istStartOf = (date: { year: number; month: number; day: number }) =>
    new Date(Date.UTC(date.year, date.month - 1, date.day) - IST_OFFSET_MS);

  function measurementData(
    session: ScreeningSession,
    input: Omit<AddMeasurementRequest, 'expectedVersion' | 'type'>,
    type: AddMeasurementRequest['type'],
    now: Date,
  ) {
    const measuredAt = new Date(input.measuredAt);
    validateMeasurement({
      type,
      value: input.value,
      unit: input.unit,
      measuredAt,
      now,
      notBefore: istStartOf(fromDbDate(session.dateOfBirthAtStart)),
    });
    return {
      childId: session.childId,
      sessionId: session.id,
      type,
      value: new Prisma.Decimal(input.value),
      unit: input.unit,
      source: input.source,
      quality: input.quality,
      measuredAt,
      method: input.method ?? null,
      deviceMake: input.deviceMake ?? null,
      deviceModel: input.deviceModel ?? null,
      deviceSerial: input.deviceSerial ?? null,
      notes: input.notes ?? null,
    };
  }

  async function get(ctx: AccessContext, id: string): Promise<ScreeningSessionResponse> {
    await assertInScopeOrDeny(db, ctx, 'screeningSession', id, 'child.read');
    return loadDetail(id, ctx);
  }

  async function list(
    ctx: AccessContext,
    where: Prisma.ScreeningSessionWhereInput,
    page: number,
    pageSize: number,
    orderBy: Prisma.ScreeningSessionOrderByWithRelationInput[],
  ): Promise<ScreeningListResponse> {
    const scoped = { AND: [where, scopedWhere.screeningSession(ctx.userId, 'child.read', at(ctx))] };
    const [total, rows] = await Promise.all([
      db.screeningSession.count({ where: scoped }),
      db.screeningSession.findMany({
        where: scoped,
        include: summaryInclude,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map((r) => toSessionSummary(r, ctx.userId)), page, pageSize, total };
  }

  return {
    // ------------------------------------------------------------------- reads

    get,

    list(ctx: AccessContext, query: ScreeningListQuery): Promise<ScreeningListResponse> {
      return list(
        ctx,
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.childId ? { childId: query.childId } : {}),
          ...(query.mine === 'true' ? { conductedById: ctx.userId } : {}),
        },
        query.page,
        query.pageSize,
        [{ updatedAt: 'desc' }, { id: 'asc' }],
      );
    },

    /** A child's screening history (paginated, newest first). */
    async history(ctx: AccessContext, childId: string, query: ScreeningHistoryQuery) {
      await findChildOrDeny(db, ctx, childId, 'child.read');
      return list(ctx, { childId }, query.page, query.pageSize, [{ startedAt: 'desc' }, { id: 'asc' }]);
    },

    /** The caller's own real counts for the dashboard (never estimated). */
    async summary(ctx: AccessContext): Promise<ScreeningDashboardSummary> {
      const now = at(ctx);
      const today = todayInIndia(now);
      const dayStart = istStartOf(today);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const scope = scopedWhere.screeningSession(ctx.userId, 'screening.conduct', now);
      const mine = (where: Prisma.ScreeningSessionWhereInput) =>
        db.screeningSession.count({ where: { AND: [where, scope, { conductedById: ctx.userId }] } });
      const [completedToday, inProgress, drafts] = await Promise.all([
        mine({ status: 'COMPLETED', completedAt: { gte: dayStart, lt: dayEnd } }),
        mine({ status: 'IN_PROGRESS' }),
        mine({ status: 'DRAFT' }),
      ]);
      return { date: formatCalendarDate(today), completedToday, inProgress, drafts };
    },

    // ------------------------------------------------------------------- start

    /**
     * Starts a session (DRAFT). Idempotent on clientOperationId. Age, area, consent and worker
     * are all derived here; the request carries only the child id.
     */
    async start(ctx: AccessContext, body: StartScreeningRequest) {
      const now = at(ctx);
      let outcome;
      try {
        outcome = await runIdempotent(
          db,
          {
            userId: ctx.userId,
            clientOperationId: body.clientOperationId,
            operationType: 'screening.start',
            entityType: 'screeningSession',
            request: body,
          },
          async (tx) => {
            const consents = await assertConsentPermits(
              tx,
              { ...ctx, auditDb: db },
              body.childId,
              'SCREENING',
              'screening.conduct',
              consentPolicy,
            );
            const child = await tx.child.findUniqueOrThrow({ where: { id: body.childId } });
            const age = screeningAge(child.dateOfBirth, child.dobIsEstimated, now);
            if (age.ageInDays === null) {
              throw AppError.unprocessable(
                'AGE_NOT_DETERMINABLE',
                'The date of birth is after today. Correct the child record before screening.',
              );
            }
            const open = await tx.screeningSession.findFirst({
              where: { childId: body.childId, status: { in: OPEN } },
              select: { id: true },
            });
            if (open) {
              throw AppError.conflict(
                'OPEN_SESSION_EXISTS',
                'This child already has an unfinished screening.',
                {
                  sessionId: open.id,
                },
              );
            }
            const candidates = await tx.screeningProtocol.findMany({
              where: {
                status: { in: screeningPolicy.allowDraftProtocols ? ['ACTIVE', 'DRAFT'] : ['ACTIVE'] },
                ageMinDays: { lte: age.ageInDays },
                ageMaxDays: { gte: age.ageInDays },
              },
            });
            const available = FOUR_D_CATEGORIES.filter(
              (c) => selectProtocol(candidates, c, age.ageInDays, screeningPolicy, now).protocol !== null,
            );
            if (available.length === 0) {
              throw AppError.unprocessable(
                'NO_CATEGORY_AVAILABLE',
                'No screening content is available for this child’s age.',
              );
            }
            const session = await tx.screeningSession.create({
              data: {
                childId: child.id,
                conductedById: ctx.userId,
                areaId: child.areaId,
                ageInDaysAtStart: age.ageInDays,
                dateOfBirthAtStart: child.dateOfBirth,
                dobEstimatedAtStart: child.dobIsEstimated,
                screeningConsentId: consents.SCREENING,
                startedAt: now,
                clientOperationId: body.clientOperationId,
              },
            });
            await recordAudit(tx, {
              actorUserId: ctx.userId,
              action: 'screening.started',
              entityType: 'screeningSession',
              entityId: session.id,
              areaId: child.areaId,
              outcome: 'SUCCESS',
              requestId: ctx.requestId,
              details: {
                childId: child.id,
                ageInDaysAtStart: age.ageInDays,
                dobEstimated: child.dobIsEstimated,
                consentId: consents.SCREENING,
                availableCategories: available,
              },
            });
            return session.id;
          },
        );
      } catch (error) {
        // Two devices starting at the same moment: the partial unique index decides.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          error.meta?.modelName === 'ScreeningSession'
        ) {
          const open = await db.screeningSession.findFirst({
            where: { childId: body.childId, status: { in: OPEN } },
            select: { id: true },
          });
          throw AppError.conflict('OPEN_SESSION_EXISTS', 'This child already has an unfinished screening.', {
            sessionId: open?.id ?? null,
          });
        }
        throw error;
      }
      // A replay re-checks access: the caller may have lost it since the first submission.
      const result = await get(ctx, outcome.entityId);
      return { result, replayed: outcome.replayed };
    },

    // ---------------------------------------------------------------- categories

    startCategory(ctx: AccessContext, id: string, body: StartCategoryRequest) {
      return write(ctx, id, { expectedVersion: body.expectedVersion }, async (tx, session) => {
        const existing = await tx.screeningSessionCategory.findUnique({
          where: { sessionId_category: { sessionId: id, category: body.category } },
          select: { id: true },
        });
        if (existing) {
          throw AppError.conflict('CATEGORY_ALREADY_STARTED', 'This category has already been started.', {
            category: body.category,
          });
        }
        const now = at(ctx);
        // The age band is decided by the age AT THE START of the session (never re-computed).
        const choice = selectProtocol(
          await usableCandidates(tx, body.category, session.ageInDaysAtStart),
          body.category,
          session.ageInDaysAtStart,
          screeningPolicy,
          now,
        );
        if (!choice.protocol) {
          throw AppError.unprocessable(
            'CATEGORY_NOT_AVAILABLE',
            'This category is not available for this child.',
            {
              category: body.category,
              reason: choice.reason,
            },
          );
        }
        const protocol = await tx.screeningProtocol.findUniqueOrThrow({
          where: { id: choice.protocol.id },
          include: { questions: true },
        });
        // Approved content must still be exactly what was reviewed (decision D).
        if (
          protocol.status !== 'DRAFT' &&
          protocolContentHash(protocolRowToDefinition(protocol)) !== protocol.contentSha256
        ) {
          logger.error('screening_protocol_integrity', { protocolId: protocol.id });
          throw AppError.conflict(
            'PROTOCOL_INTEGRITY_ERROR',
            'The screening content failed an integrity check. Contact the programme administrator.',
          );
        }
        await tx.screeningSessionCategory.create({
          data: {
            sessionId: id,
            category: body.category,
            protocolId: protocol.id,
            protocolStatusAtStart: protocol.status,
            startedAt: now,
          },
        });
        return {
          patch: startedPatch(session),
          audit: [
            {
              action: 'screening.category_started',
              details: {
                category: body.category,
                protocolId: protocol.id,
                protocolCode: protocol.code,
                protocolVersion: protocol.version,
                protocolStatus: protocol.status,
              },
            },
          ],
        };
      });
    },

    saveResponses(
      ctx: AccessContext,
      id: string,
      category: FourDCategoryCode,
      body: { expectedVersion: number; responses: ResponseInput[]; cleared: string[] },
    ) {
      return write(ctx, id, { expectedVersion: body.expectedVersion }, async (tx, session) => {
        const cat = await categoryOf(tx, id, category);
        if (cat.status !== 'IN_PROGRESS') {
          throw AppError.conflict(
            'CATEGORY_COMPLETED',
            'This category is completed. Reopen it to change answers.',
          );
        }
        const questions = new Map(cat.protocol.questions.map((q) => [q.id, q]));
        const questionOf = (questionId: string) => {
          const q = questions.get(questionId);
          if (!q) {
            throw AppError.unprocessable(
              'QUESTION_NOT_IN_PROTOCOL',
              'A question does not belong to the screening content used for this category.',
              { questionId },
            );
          }
          return q;
        };
        const existing = new Map(
          (await tx.screeningObservation.findMany({ where: { sessionCategoryId: cat.id } })).map((o) => [
            o.questionId,
            o,
          ]),
        );
        const now = at(ctx);
        let created = 0;
        let changed = 0;
        for (const input of body.responses) {
          const question = questionOf(input.questionId);
          const data = {
            status: input.status,
            source: input.source,
            notes: input.notes ?? null,
            notAssessedReason: input.notAssessedReason ?? null,
            ...responseColumns(question, input),
          };
          const before = existing.get(question.id);
          if (!before) {
            await tx.screeningObservation.create({
              data: {
                ...data,
                sessionId: id,
                sessionCategoryId: cat.id,
                questionId: question.id,
                recordedById: ctx.userId,
                recordedAt: now,
              },
            });
            created += 1;
          } else if (responseChanged(before, data)) {
            await tx.screeningObservation.update({
              where: { id: before.id },
              data: { ...data, recordedById: ctx.userId, recordedAt: now },
            });
            changed += 1;
          }
        }
        let cleared = 0;
        for (const questionId of body.cleared) {
          const before = existing.get(questionOf(questionId).id);
          if (before) {
            await tx.screeningObservation.delete({ where: { id: before.id } });
            cleared += 1;
          }
        }
        return {
          patch: startedPatch(session),
          audit:
            created + changed + cleared > 0
              ? [{ action: 'screening.responses_saved', details: { category, created, changed, cleared } }]
              : [],
        };
      });
    },

    updateCategory(ctx: AccessContext, id: string, category: FourDCategoryCode, body: UpdateCategoryRequest) {
      return write(ctx, id, { expectedVersion: body.expectedVersion }, async (tx, session) => {
        const cat = await categoryOf(tx, id, category);
        const data: Prisma.ScreeningSessionCategoryUpdateInput = {};
        const audit: SessionChange['audit'] = [];
        if (body.notes !== undefined && body.notes !== cat.notes) {
          data.notes = body.notes;
          audit.push({ action: 'screening.category_notes_updated', details: { category } });
        }
        if (body.status === 'COMPLETED' && cat.status !== 'COMPLETED') {
          const answered = new Set(
            (
              await tx.screeningObservation.findMany({
                where: { sessionCategoryId: cat.id },
                select: { questionId: true },
              })
            ).map((o) => o.questionId),
          );
          const missing = cat.protocol.questions.filter((q) => q.isRequired && !answered.has(q.id));
          if (missing.length > 0) {
            throw AppError.unprocessable(
              'REQUIRED_QUESTIONS_MISSING',
              'Every required question needs an answer, Unknown or Not assessed before finishing.',
              { questionCodes: missing.map((q) => q.code) },
            );
          }
          data.status = 'COMPLETED';
          data.completedAt = at(ctx);
          audit.push({ action: 'screening.category_completed', details: { category } });
        } else if (body.status === 'IN_PROGRESS' && cat.status === 'COMPLETED') {
          data.status = 'IN_PROGRESS';
          data.completedAt = null;
          audit.push({ action: 'screening.category_reopened', details: { category } });
        }
        if (Object.keys(data).length > 0) {
          await tx.screeningSessionCategory.update({ where: { id: cat.id }, data });
        }
        return { patch: startedPatch(session), audit };
      });
    },

    // ------------------------------------------------------------- measurements

    addMeasurement(ctx: AccessContext, id: string, body: AddMeasurementRequest) {
      return write(ctx, id, { expectedVersion: body.expectedVersion }, async (tx, session) => {
        const created = await tx.measurement.create({
          data: { ...measurementData(session, body, body.type, at(ctx)), recordedById: ctx.userId },
        });
        return {
          patch: startedPatch(session),
          audit: [
            {
              action: 'screening.measurement_added',
              details: {
                measurementId: created.id,
                type: body.type,
                source: body.source,
                quality: body.quality,
              },
            },
          ],
        };
      });
    },

    correctMeasurement(
      ctx: AccessContext,
      id: string,
      measurementId: string,
      body: CorrectMeasurementRequest,
    ) {
      return write(ctx, id, { expectedVersion: body.expectedVersion }, async (tx, session) => {
        const original = await tx.measurement.findFirst({
          where: { id: measurementId, sessionId: id },
          include: { supersededBy: { select: { id: true } } },
        });
        if (!original) throw AppError.notFound('Measurement not found');
        if (original.supersededBy) {
          throw AppError.conflict(
            'MEASUREMENT_ALREADY_CORRECTED',
            'This measurement was already corrected. Correct the latest value instead.',
            { correctedById: original.supersededBy.id },
          );
        }
        const type = original.type as AddMeasurementRequest['type'];
        const created = await tx.measurement.create({
          data: {
            ...measurementData(session, body, type, at(ctx)),
            recordedById: ctx.userId,
            supersedesId: original.id,
            correctionReason: body.correctionReason,
          },
        });
        return {
          patch: startedPatch(session),
          audit: [
            {
              action: 'screening.measurement_corrected',
              details: { measurementId: original.id, correctedById: created.id, type },
            },
          ],
        };
      });
    },

    // ---------------------------------------------------------------- lifecycle

    /**
     * Completes the session. Idempotent: completing an already completed session returns it
     * unchanged with its ORIGINAL completion time. Categories never started are reported as not
     * assessed; started but unfinished categories stay "in progress" (incomplete) for ever.
     */
    async complete(ctx: AccessContext, id: string, body: CompleteSessionRequest) {
      await assertInScopeOrDeny(db, ctx, 'screeningSession', id, 'screening.conduct');
      const current = await db.screeningSession.findUniqueOrThrow({ where: { id } });
      if (current.status === 'COMPLETED' && current.conductedById === ctx.userId) {
        return { result: await loadDetail(id, ctx), replayed: true };
      }
      const completeOnce = () =>
        write(ctx, id, { expectedVersion: body.expectedVersion }, async (tx) => {
          const categories = await tx.screeningSessionCategory.findMany({
            where: { sessionId: id },
            select: { category: true, status: true },
          });
          const completed = categories.filter((c) => c.status === 'COMPLETED').map((c) => c.category);
          if (completed.length === 0) {
            throw AppError.unprocessable(
              'NO_COMPLETED_CATEGORY',
              'Finish at least one screening category before completing the screening.',
            );
          }
          const incomplete = categories.filter((c) => c.status !== 'COMPLETED').map((c) => c.category);
          const started = new Set(categories.map((c) => c.category));
          return {
            patch: { status: 'COMPLETED', completedAt: at(ctx) },
            audit: [
              {
                action: 'screening.completed',
                details: {
                  categoriesCompleted: completed,
                  categoriesIncomplete: incomplete,
                  categoriesNotAssessed: FOUR_D_CATEGORIES.filter((c) => !started.has(c)),
                },
              },
            ],
          };
        });
      try {
        return { result: await completeOnce(), replayed: false };
      } catch (error) {
        // A concurrent completion won the row lock first: answer as a replay, not a failure.
        if (error instanceof AppError && error.code === 'SESSION_FINAL') {
          const after = await db.screeningSession.findUniqueOrThrow({ where: { id } });
          if (after.status === 'COMPLETED') return { result: await loadDetail(id, ctx), replayed: true };
        }
        throw error;
      }
    },

    cancel(ctx: AccessContext, id: string, body: CancelSessionRequest) {
      return write(ctx, id, { expectedVersion: body.expectedVersion, requireConsent: false }, () =>
        Promise.resolve({
          patch: {
            status: 'CANCELLED',
            cancelledAt: at(ctx),
            cancelledById: ctx.userId,
            cancelReason: body.reason,
          },
          audit: [{ action: 'screening.cancelled', details: {} }],
        }),
      );
    },
  };
}
