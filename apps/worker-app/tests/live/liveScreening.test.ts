/**
 * OPT-IN end-to-end screening check against a RUNNING API (Step 6F; never part of `npm test` by
 * default). Uses the app's real modules - HTTP layer, SessionManager, API client, children and
 * screening feature APIs - so every real response is validated against the shared contracts.
 *
 *   $env:LIVE_WORKER_PASSWORD="<8+ characters>"; npm run db:dev-live-worker   # synthetic ASHA
 *   $env:LIVE_API_URL="http://localhost:4000/api/v1"
 *   $env:LIVE_WORKER_LOGIN="LIVE-ASHA-01"
 *   npx jest tests/live/liveScreening
 *
 * Needs a development API (draft consent notices and demonstration protocols are allowed only
 * outside production) with the seed applied. Creates synthetic records only. Credentials come from
 * the environment and are never printed.
 */
import type { ScreeningSessionDetail } from '@balswasthya/shared-contracts';
import { createChildrenApi } from '../../src/features/children/api';
import { createScreeningApi } from '../../src/features/screening/api';
import { createAppServices } from '../../src/services/appServices';
import { createMemoryStore } from '../../src/services/storage/secureStorage';
import { newSubmissionId } from '../../src/utils/submissionId';
import { nodeFetch } from './nodeFetch';

const { LIVE_API_URL, LIVE_WORKER_LOGIN, LIVE_WORKER_PASSWORD } = process.env;
const enabled = Boolean(LIVE_API_URL && LIVE_WORKER_LOGIN && LIVE_WORKER_PASSWORD);

/** A unique, letters-only synthetic name (names may not contain digits). */
function syntheticName() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const pick = () => letters[Math.floor(Math.random() * letters.length)];
  return `Synthetic Live ${Array.from({ length: 8 }, pick).join('')}`;
}

(enabled ? describe : describe.skip)('live screening end to end (Step 6 backend + app modules)', () => {
  jest.setTimeout(120_000);
  const services = createAppServices({
    config: { api: { ok: true, url: LIVE_API_URL! }, requestTimeoutMs: 20_000 },
    store: createMemoryStore(),
    fetchFn: nodeFetch,
  });
  const children = createChildrenApi(services.api);
  const screening = createScreeningApi(services.api);
  const NOTE = 'Synthetic live note, encrypted at rest';
  let childId = '';
  let session: ScreeningSessionDetail;

  it('signs in as the synthetic worker', async () => {
    await services.session.initialize();
    await services.session.login(LIVE_WORKER_LOGIN!, LIVE_WORKER_PASSWORD!);
    expect(services.session.getState()).toMatchObject({ status: 'authenticated' });
  });

  it('registers a child and records SCREENING consent', async () => {
    const area = (await children.registrationAreas()).items[0];
    expect(area).toBeDefined();
    const registered = await children.register({
      clientOperationId: newSubmissionId(),
      fullName: syntheticName(),
      dateOfBirth: '2019-06-15',
      sexAtBirth: 'FEMALE',
      areaId: area!.id,
      confirmNotDuplicate: true,
      guardians: [
        {
          newGuardian: { fullName: 'Synthetic Live Mother' },
          relationship: 'MOTHER',
          isPrimaryContact: true,
          canGiveConsent: true,
          confirmNewGuardian: true,
        },
      ],
    });
    childId = registered.child.id;
    const notice = (await children.consentNotices('hi')).items.find((n) => n.purpose === 'SCREENING')!;
    const consent = await children.recordConsent(childId, {
      clientOperationId: newSubmissionId(),
      guardianId: registered.child.guardians[0]!.guardianId,
      purpose: 'SCREENING',
      decision: 'GRANTED',
      method: 'SIGNATURE',
      templateId: notice.templateId,
    });
    expect(consent.status.permitted).toBe(true);
  });

  it('checks eligibility and starts a session (idempotent on retry)', async () => {
    const eligibility = await screening.eligibility(childId);
    expect(eligibility).toMatchObject({ canStart: true, blockers: [], ageInDays: expect.any(Number) });
    const operation = newSubmissionId();
    session = (await screening.start({ clientOperationId: operation, childId })).session;
    const retry = (await screening.start({ clientOperationId: operation, childId })).session;
    expect(retry.id).toBe(session.id);
    expect(session).toMatchObject({ status: 'DRAFT', version: 1, isMine: true, canEdit: true });
  });

  it('screens one category: explicit answer states, a note, finish', async () => {
    const eligibility = await screening.eligibility(childId);
    const category = eligibility.categories.find((c) => c.available)!.category;
    session = (await screening.startCategory(session.id, session.version, category)).session;
    const started = session.sessionCategories[0]!;
    const protocol = (await screening.protocol(started.protocol.id)).protocol;
    const responses = protocol.questions.map((q, index) =>
      q.answerType === 'YES_NO'
        ? {
            questionId: q.id,
            status: 'ANSWERED' as const,
            source: 'WORKER_OBSERVED' as const,
            value: true,
            ...(index === 0 ? { notes: NOTE } : {}),
          }
        : {
            questionId: q.id,
            status: 'NOT_ASSESSED' as const,
            source: 'GUARDIAN_REPORTED' as const,
            notAssessedReason: 'Synthetic reason',
          },
    );
    session = (
      await screening.saveResponses(session.id, category, { expectedVersion: session.version, responses })
    ).session;
    session = (
      await screening.updateCategory(session.id, category, {
        expectedVersion: session.version,
        status: 'COMPLETED',
      })
    ).session;
    const done = session.sessionCategories[0]!;
    expect(done.status).toBe('COMPLETED');
    expect(done.completeness.notAnswered).toBe(0);
    expect(done.responses.some((r) => r.notes === NOTE)).toBe(true);
  });

  it('records and corrects a measurement exactly as typed', async () => {
    session = (
      await screening.addMeasurement(session.id, {
        expectedVersion: session.version,
        type: 'WEIGHT',
        value: '3250',
        unit: 'g',
        source: 'MEASURED',
        quality: 'RELIABLE',
        measuredAt: new Date().toISOString(),
      })
    ).session;
    const original = session.measurements[0]!;
    expect([original.value, original.unit, original.converted]).toEqual([
      '3250',
      'g',
      { value: '3.25', unit: 'kg' },
    ]);
    session = (
      await screening.correctMeasurement(session.id, original.id, {
        expectedVersion: session.version,
        value: '3300',
        unit: 'g',
        source: 'MEASURED',
        quality: 'RELIABLE',
        measuredAt: new Date().toISOString(),
        correctionReason: 'Synthetic correction',
      })
    ).session;
    expect(session.measurements.map((m) => m.isCurrent)).toEqual([false, true]);
  });

  it('refuses a stale version instead of overwriting', async () => {
    const error = await screening
      .addMeasurement(session.id, {
        expectedVersion: session.version - 1,
        type: 'MUAC',
        value: '14.5',
        unit: 'cm',
        source: 'MEASURED',
        quality: 'RELIABLE',
        measuredAt: new Date().toISOString(),
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
  });

  it('completes once (idempotent) and reports observations only', async () => {
    const completed = (await screening.complete(session.id, session.version)).session;
    const again = (await screening.complete(session.id, 1)).session;
    expect(completed.status).toBe('COMPLETED');
    expect(again.completedAt).toBe(completed.completedAt);
    expect(completed.screeningRulesApplied).toBe(false);
    expect(completed.categoriesNotAssessed).toHaveLength(3);
  });

  it('shows the screening in the history and in the worker counts', async () => {
    const history = await screening.history(childId, 1);
    expect(history.items.map((i) => i.id)).toContain(session.id);
    const summary = await screening.summary();
    expect(summary.completedToday).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------ Step 6G-2: amendments
  it('amends the completed screening as the conducting worker: new version, old -> new, review pending', async () => {
    const current = (await screening.get(session.id)).session;
    expect(current).toMatchObject({
      canAmend: true,
      amendBasis: 'CONDUCTOR_WITHIN_WINDOW',
      currentVersion: 1,
    });
    expect(current.amendableUntil).not.toBeNull();
    const category = current.sessionCategories.find((c) => c.status === 'COMPLETED')!;
    const protocol = (await screening.protocol(category.protocol.id)).protocol;
    const yesNo = protocol.questions.find((q) => q.answerType === 'YES_NO')!;
    const before = category.responses.find((r) => r.questionId === yesNo.id);

    const operation = newSubmissionId();
    const body = {
      clientOperationId: operation,
      expectedSequence: 0,
      reason: 'Synthetic live correction',
      changes: [
        {
          kind: 'RESPONSE' as const,
          category: category.category,
          questionId: yesNo.id,
          status: 'UNKNOWN' as const,
          source: 'GUARDIAN_REPORTED' as const,
        },
      ],
    };
    const amended = (await screening.amend(session.id, body)).session;
    expect(amended.currentVersion).toBe(2);
    const a = amended.amendments[0]!;
    expect(a).toMatchObject({
      sequence: 1,
      version: 2,
      basis: 'CONDUCTOR_WITHIN_WINDOW',
      reason: 'Synthetic live correction',
      clinicallySignificant: true,
      reviewStatus: 'PENDING',
    });
    expect(a.changes[0]).toMatchObject({
      kind: 'RESPONSE',
      oldValue: before ? expect.objectContaining({ status: before.status }) : null,
      newValue: expect.objectContaining({ status: 'UNKNOWN', source: 'GUARDIAN_REPORTED' }),
    });
    const shown = amended.sessionCategories
      .find((c) => c.category === category.category)!
      .responses.find((r) => r.questionId === yesNo.id)!;
    expect(shown).toMatchObject({ status: 'UNKNOWN', amended: true });

    // Retrying the same operation returns the first result; it does not add a version.
    const replay = (await screening.amend(session.id, body)).session;
    expect(replay.currentVersion).toBe(2);
    // A stale sequence is refused instead of silently overwriting.
    const stale = await screening
      .amend(session.id, { ...body, clientOperationId: newSubmissionId() })
      .catch((e: unknown) => e);
    expect(stale).toMatchObject({ status: 409, code: 'AMENDMENT_CONFLICT' });
  });

  it('an observations-only amendment needs no medical review', async () => {
    const current = (await screening.get(session.id)).session;
    const category = current.sessionCategories[0]!;
    const amended = (
      await screening.amend(session.id, {
        clientOperationId: newSubmissionId(),
        expectedSequence: current.amendments.length,
        reason: 'Synthetic note correction',
        changes: [{ kind: 'CATEGORY_NOTES', category: category.category, notes: 'Synthetic corrected note' }],
      })
    ).session;
    expect(amended.currentVersion).toBe(3);
    expect(amended.amendments.find((x) => x.sequence === 2)).toMatchObject({
      clinicallySignificant: false,
      reviewStatus: 'NOT_REQUIRED',
    });
    expect(amended.sessionCategories[0]).toMatchObject({
      notes: 'Synthetic corrected note',
      notesAmended: true,
    });
  });
});
