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
});
