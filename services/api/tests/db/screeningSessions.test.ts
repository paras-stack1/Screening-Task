import { randomUUID } from 'node:crypto';
import {
  childDetailResponseSchema,
  screeningDashboardSummarySchema,
  screeningListResponseSchema,
  screeningProtocolDetailResponseSchema,
  screeningSessionResponseSchema,
  type FourDCategoryCode,
  type ScreeningSessionDetail,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { ensureConsentTemplates } from '../../src/modules/consent/consentNotices';
import { ensureDemoProtocols } from '../../src/modules/screening/demoProtocols';
import { testAuthConfig } from './authFixture';
import { api, buildAuthzFixture, TestClock, tokenFor, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 6, stage 6C: the screening session API end to end (real HTTP, real database, synthetic
 * data). World: tests/db/authzFixture.ts - asha1 and ashaboth work in V1, asha5 in another
 * district, sup1 supervises B1 (child.read only), dadmin1 has no child access.
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createApp>;
const tokens = new Map<string, string>();
const questions = new Map<string, Record<string, string>>(); // category -> code -> questionId

function makeApp(writeLimit = 10_000) {
  return createApp({
    auth: {
      db: prisma,
      config: testAuthConfig,
      now: clock.now,
      rateLimits: {
        ...DEFAULT_RATE_LIMITS,
        loginPerIpAndAccount: 1000,
        loginPerIp: 1000,
        childDataReadPerUser: 10_000,
        childDataWritePerUser: writeLimit,
      },
    },
    consentPolicy: { allowDraftNotices: true },
    screeningPolicy: { allowDraftProtocols: true },
  });
}

async function as(login: string) {
  if (!tokens.has(login)) tokens.set(login, await tokenFor(app, login));
  return api(app, tokens.get(login)!);
}

let seq = 0;
const letters = 'abcdefghijklmnopqrstuvwxyz';
/** A V1 child, 9-10 years old (outside the fixture's SYN band: one demo protocol per D). */
async function newChild(withConsent = true) {
  seq += 1;
  const res = await (
    await as('asha1')
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: `Synthetic Screened ${letters[seq % 26]}${letters[(seq * 7) % 26]}${letters[(seq * 3) % 26]}`,
    dateOfBirth: '2016-04-15',
    sexAtBirth: 'FEMALE',
    areaId: fx.area.V1!,
    confirmNotDuplicate: true,
    guardians: [
      {
        newGuardian: { fullName: 'Synthetic Mother' },
        relationship: 'MOTHER',
        isPrimaryContact: true,
        canGiveConsent: true,
        confirmNewGuardian: true,
      },
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const child = childDetailResponseSchema.parse(res.body).child;
  const mother = child.guardians[0]!.guardianId;
  const consentId = withConsent ? await consent(child.id, mother, 'GRANTED') : null;
  return { id: child.id, mother, consentId };
}

async function consent(childId: string, guardianId: string, decision: 'GRANTED' | 'REFUSED') {
  const template = await prisma.consentTemplate.findFirstOrThrow({
    where: { purpose: 'SCREENING', version: 1, languageCode: 'hi' },
  });
  clock.advance(1000);
  const res = await (
    await as('asha1')
  ).post(`/children/${childId}/consents`, {
    clientOperationId: randomUUID(),
    guardianId,
    purpose: 'SCREENING',
    decision,
    method: 'SIGNATURE',
    templateId: template.id,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.consent.id as string;
}

function session(res: request.Response): ScreeningSessionDetail {
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return screeningSessionResponseSchema.parse(res.body).session;
}

async function start(childId: string, login = 'asha1', clientOperationId = randomUUID()) {
  return (await as(login)).post('/screenings', { clientOperationId, childId });
}

async function startCategory(s: ScreeningSessionDetail, category: FourDCategoryCode, login = 'asha1') {
  return (await as(login)).post(`/screenings/${s.id}/categories`, { expectedVersion: s.version, category });
}

async function save(
  s: ScreeningSessionDetail,
  category: FourDCategoryCode,
  responses: object[],
  cleared: string[] = [],
) {
  return (await as('asha1')).post(`/screenings/${s.id}/categories/${category}/responses`, {
    expectedVersion: s.version,
    responses,
    cleared,
  });
}

const q = (category: string, code: string) => questions.get(category)![code]!;
const yes = (questionId: string, value: unknown = true) => ({
  questionId,
  status: 'ANSWERED',
  source: 'WORKER_OBSERVED',
  value,
});

function measurement(s: ScreeningSessionDetail, extra: object = {}) {
  return {
    expectedVersion: s.version,
    type: 'WEIGHT',
    value: '24.35',
    unit: 'kg',
    source: 'MEASURED',
    quality: 'RELIABLE',
    measuredAt: clock.now().toISOString(),
    deviceMake: 'Synthetic Scales',
    ...extra,
  };
}

/** Correction body: same fields without the type (a correction can never change it). */
function correction(s: ScreeningSessionDetail, extra: object = {}) {
  const { type: _type, ...rest } = measurement(s, extra) as Record<string, unknown>;
  return rest;
}

/** A session with D3 (DISEASES) started; required question DEMO_Q1 not yet answered. */
async function sessionWithDiseases(child?: Awaited<ReturnType<typeof newChild>>) {
  const c = child ?? (await newChild());
  const s = session(await start(c.id));
  return { child: c, s: session(await startCategory(s, 'DISEASES')) };
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  app = makeApp();
  fx = await buildAuthzFixture(prisma, clock);
  expect(await ensureConsentTemplates(prisma)).toEqual([]);
  expect(await ensureDemoProtocols(prisma)).toEqual([]);
  for (const p of await prisma.screeningProtocol.findMany({ where: { isDemonstration: true } })) {
    const res = await (await as('asha1')).get(`/screening-protocols/${p.id}`);
    const detail = screeningProtocolDetailResponseSchema.parse(res.body).protocol;
    questions.set(p.category, Object.fromEntries(detail.questions.map((x) => [x.code, x.id])));
  }
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

// =========================================================================== start

describe('POST /screenings (start)', () => {
  it('creates a DRAFT session with server-derived age, area, worker and consent', async () => {
    const child = await newChild();
    const res = await start(child.id);
    expect(res.status).toBe(201);
    const s = session(res);
    expect(s).toMatchObject({
      status: 'DRAFT',
      version: 1,
      childId: child.id,
      isMine: true,
      canEdit: true,
      ageInDaysAtStart: 3872, // 2016-04-15 -> 2026-11-21 (India date of the test clock)
      ageAtStart: { years: 10, months: 7 },
      dobEstimatedAtStart: false,
      screeningConsentId: child.consentId,
      sessionCategories: [],
      screeningRulesApplied: false,
    });
    expect(s.categoriesNotAssessed).toHaveLength(4);
    const row = await prisma.screeningSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ conductedById: fx.user.asha1, areaId: fx.area.V1 });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'screening.started', entityId: s.id },
    });
    expect(audit).toMatchObject({ actorUserId: fx.user.asha1, outcome: 'SUCCESS' });
  });

  it('is idempotent: a retry returns the same session; a reused id with other data is refused', async () => {
    const child = await newChild();
    const op = randomUUID();
    const first = session(await start(child.id, 'asha1', op));
    const retry = await start(child.id, 'asha1', op);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(session(retry).id).toBe(first.id);
    const other = await newChild();
    const reused = await start(other.id, 'asha1', op);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.screeningSession.count({ where: { childId: child.id } })).toBe(1);
  });

  it('refuses a second open session for the same child, pointing to the open one', async () => {
    const child = await newChild();
    const first = session(await start(child.id));
    const second = await start(child.id);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'OPEN_SESSION_EXISTS',
      details: { sessionId: first.id },
    });
  });

  it('blocks screening without consent, with refused consent, and after withdrawal (no bypass)', async () => {
    const none = await newChild(false);
    const res = await start(none.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');

    await consent(none.id, none.mother, 'REFUSED');
    expect((await start(none.id)).body.error.code).toBe('CONSENT_REQUIRED');

    const withdrawn = await newChild();
    const w = await (
      await as('asha1')
    ).post(`/children/${withdrawn.id}/consents/${withdrawn.consentId}/withdraw`, {
      guardianId: withdrawn.mother,
      method: 'SIGNATURE',
    });
    expect(w.status).toBe(200);
    expect((await start(withdrawn.id)).body.error.code).toBe('CONSENT_REQUIRED');
    expect(await prisma.screeningSession.count({ where: { childId: { in: [none.id, withdrawn.id] } } })).toBe(
      0,
    );
    expect(
      await prisma.auditLog.count({ where: { action: 'consent.check_denied', entityId: withdrawn.id } }),
    ).toBeGreaterThan(0);
  });

  it('enforces permission and area: other district 404 (audited), supervisor and admin 403', async () => {
    const child = await newChild();
    const res = await start(child.id, 'asha5');
    expect(res.status).toBe(404);
    expect(
      await prisma.auditLog.count({
        where: { action: 'child.access_denied', entityId: child.id, actorUserId: fx.user.asha5! },
      }),
    ).toBeGreaterThan(0);
    expect((await start(child.id, 'sup1')).status).toBe(403);
    expect((await start(child.id, 'dadmin1')).status).toBe(403);
    expect((await start(randomUUID())).status).toBe(404);
    expect(
      (await (await as('asha1')).post('/screenings', { clientOperationId: randomUUID(), childId: 'x' }))
        .status,
    ).toBe(400);
  });

  it('rejects client-supplied server fields (mass assignment)', async () => {
    const child = await newChild();
    for (const extra of [
      { conductedById: fx.user.asha5 },
      { status: 'COMPLETED' },
      { ageInDaysAtStart: 1 },
    ]) {
      const res = await (
        await as('asha1')
      ).post('/screenings', { clientOperationId: randomUUID(), childId: child.id, ...extra });
      expect(res.status).toBe(400);
    }
  });

  it('requires a valid access token', async () => {
    expect((await request(app).get('/api/v1/screenings')).status).toBe(401);
    expect((await request(app).post('/api/v1/screenings').send({})).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/screenings').set('Authorization', 'Bearer not-a-token')).status,
    ).toBe(401);
  });
});

// ====================================================================== categories

describe('Four-D categories', () => {
  it('starts each of D1-D4 with the exact protocol version, independently', async () => {
    const child = await newChild();
    let s = session(await start(child.id));
    for (const category of [
      'DEFECTS_AT_BIRTH',
      'DEFICIENCIES',
      'DISEASES',
      'DEVELOPMENTAL_DELAYS_DISABILITIES',
    ] as const) {
      const res = await startCategory(s, category);
      expect(res.status).toBe(201);
      s = session(res);
      const cat = s.sessionCategories.find((c) => c.category === category)!;
      expect(cat).toMatchObject({
        status: 'IN_PROGRESS',
        protocolStatusAtStart: 'DRAFT',
        usedApprovedContent: false,
      });
      expect(cat.protocol.isDemonstration).toBe(true);
    }
    expect(s.status).toBe('IN_PROGRESS');
    expect(s.version).toBe(5);
    expect(s.categoriesNotAssessed).toEqual([]);
    expect(s.usesUnapprovedContent).toBe(true);
  });

  it('refuses a duplicate category, a stale version and an unknown category code', async () => {
    const { s } = await sessionWithDiseases();
    const dup = await startCategory(s, 'DISEASES');
    expect(dup.body.error.code).toBe('CATEGORY_ALREADY_STARTED');
    const stale = await startCategory({ ...s, version: 1 }, 'DEFICIENCIES');
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: s.version },
    });
    expect((await startCategory(s, 'D5' as FourDCategoryCode)).status).toBe(400);
  });
});

// ======================================================================== responses

describe('responses', () => {
  it('records YES, NO, UNKNOWN and NOT_ASSESSED distinctly; missing stays missing', async () => {
    const { s } = await sessionWithDiseases();
    const res = await save(s, 'DISEASES', [
      { questionId: q('DISEASES', 'DEMO_Q1'), status: 'UNKNOWN', source: 'GUARDIAN_REPORTED' },
      {
        questionId: q('DISEASES', 'DEMO_Q2'),
        status: 'NOT_ASSESSED',
        source: 'WORKER_OBSERVED',
        notAssessedReason: 'Child asleep',
      },
    ]);
    const saved = session(res);
    const cat = saved.sessionCategories[0]!;
    expect(cat.responses.map((r) => [r.questionCode, r.status, r.value])).toEqual([
      ['DEMO_Q1', 'UNKNOWN', null],
      ['DEMO_Q2', 'NOT_ASSESSED', null],
    ]);
    expect(cat.completeness).toMatchObject({ answered: 0, unknown: 1, notAssessed: 1, notAnswered: 1 });

    const s2 = session(await save(saved, 'DISEASES', [yes(q('DISEASES', 'DEMO_Q1'), false)]));
    const r1 = s2.sessionCategories[0]!.responses[0]!;
    expect([r1.status, r1.value, r1.source]).toEqual(['ANSWERED', false, 'WORKER_OBSERVED']);

    const s3 = session(await save(s2, 'DISEASES', [], [q('DISEASES', 'DEMO_Q2')]));
    expect(s3.sessionCategories[0]!.completeness.notAnswered).toBe(2);
  });

  it('validates values against the question; wrong-protocol questions are refused', async () => {
    const { s } = await sessionWithDiseases();
    const cases: Array<[object, number, string]> = [
      [yes(q('DISEASES', 'DEMO_Q1'), 'yes'), 422, 'INVALID_RESPONSE'],
      [yes(q('DISEASES', 'DEMO_Q2'), 1.5), 422, 'INVALID_RESPONSE'], // maxDecimals 0
      [yes(q('DISEASES', 'DEMO_Q2'), 1000), 422, 'INVALID_RESPONSE'], // max 999
      [yes(q('DISEASES', 'DEMO_Q3'), 'x'.repeat(501)), 422, 'INVALID_RESPONSE'],
      [yes(q('DEFECTS_AT_BIRTH', 'DEMO_Q1')), 422, 'QUESTION_NOT_IN_PROTOCOL'],
      [yes(randomUUID()), 422, 'QUESTION_NOT_IN_PROTOCOL'],
      [
        { questionId: q('DISEASES', 'DEMO_Q1'), status: 'ANSWERED', source: 'WORKER_OBSERVED' },
        400,
        'VALIDATION_ERROR',
      ],
      [{ ...yes(q('DISEASES', 'DEMO_Q1')), status: 'MAYBE' }, 400, 'VALIDATION_ERROR'],
    ];
    for (const [response, status, code] of cases) {
      const res = await save(s, 'DISEASES', [response]);
      expect([res.status, res.body.error?.code], JSON.stringify(response)).toEqual([status, code]);
    }
    // Nothing was stored by any refused save, and the version did not move.
    const after = session(await (await as('asha1')).get(`/screenings/${s.id}`));
    expect([after.version, after.sessionCategories[0]!.responses.length]).toEqual([s.version, 0]);
  });

  it('accepts single and multiple choice answers from the option list', async () => {
    const child = await newChild();
    let s = session(await start(child.id));
    s = session(await startCategory(s, 'DEFICIENCIES'));
    s = session(
      await save(s, 'DEFICIENCIES', [yes(q('DEFICIENCIES', 'DEMO_Q2'), ['DEMO_OPTION_B', 'DEMO_OPTION_A'])]),
    );
    expect(s.sessionCategories[0]!.responses[0]!.value).toEqual(['DEMO_OPTION_B', 'DEMO_OPTION_A']);
    const bad = await save(s, 'DEFICIENCIES', [yes(q('DEFICIENCIES', 'DEMO_Q2'), ['NOT_AN_OPTION'])]);
    expect(bad.status).toBe(422);
  });

  it('audits saves with counts only - never values or notes', async () => {
    const { s } = await sessionWithDiseases();
    await save(s, 'DISEASES', [
      { ...yes(q('DISEASES', 'DEMO_Q3'), 'SECRET-NOTE-TEXT'), notes: 'SECRET-NOTE-2' },
    ]);
    const rows = await prisma.auditLog.findMany({ where: { entityId: s.id } });
    const saved = rows.find((r) => r.action === 'screening.responses_saved')!;
    expect(saved.details).toEqual({ category: 'DISEASES', created: 1, changed: 0, cleared: 0 });
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|Synthetic Screened/);
  });

  it('completes a category only when every required question has an explicit state', async () => {
    const { s } = await sessionWithDiseases();
    const early = await (
      await as('asha1')
    ).patch(`/screenings/${s.id}/categories/DISEASES`, {
      expectedVersion: s.version,
      status: 'COMPLETED',
    });
    expect(early.status).toBe(422);
    expect(early.body.error).toMatchObject({
      code: 'REQUIRED_QUESTIONS_MISSING',
      details: { questionCodes: ['DEMO_Q1'] },
    });

    // UNKNOWN is an explicit state: allowed, and recorded as unknown (not as "No").
    const s2 = session(
      await save(s, 'DISEASES', [
        { questionId: q('DISEASES', 'DEMO_Q1'), status: 'UNKNOWN', source: 'WORKER_OBSERVED' },
      ]),
    );
    const done = session(
      await (
        await as('asha1')
      ).patch(`/screenings/${s.id}/categories/DISEASES`, {
        expectedVersion: s2.version,
        status: 'COMPLETED',
        notes: 'Worker observation (synthetic)',
      }),
    );
    expect(done.sessionCategories[0]).toMatchObject({
      status: 'COMPLETED',
      notes: 'Worker observation (synthetic)',
    });

    const locked = await save(done, 'DISEASES', [yes(q('DISEASES', 'DEMO_Q1'))]);
    expect(locked.body.error.code).toBe('CATEGORY_COMPLETED');
    const reopened = session(
      await (
        await as('asha1')
      ).patch(`/screenings/${s.id}/categories/DISEASES`, {
        expectedVersion: done.version,
        status: 'IN_PROGRESS',
      }),
    );
    expect(reopened.sessionCategories[0]!.completedAt).toBeNull();
  });
});

// ===================================================================== measurements

describe('measurements', () => {
  it('stores values exactly as entered with unit, source and device; converts for display only', async () => {
    let { s } = await sessionWithDiseases();
    s = session(await (await as('asha1')).post(`/screenings/${s.id}/measurements`, measurement(s)));
    s = session(
      await (
        await as('asha1')
      ).post(
        `/screenings/${s.id}/measurements`,
        measurement(s, {
          type: 'HEIGHT',
          value: '1324',
          unit: 'mm',
          source: 'GUARDIAN_REPORTED',
          quality: 'QUESTIONABLE',
        }),
      ),
    );
    s = session(
      await (
        await as('asha1')
      ).post(`/screenings/${s.id}/measurements`, measurement(s, { type: 'MUAC', value: '17.5', unit: 'cm' })),
    );
    expect(
      s.measurements.map((m) => [m.type, m.value, m.unit, m.converted.value, m.converted.unit, m.source]),
    ).toEqual([
      ['WEIGHT', '24.35', 'kg', '24.35', 'kg', 'MEASURED'],
      ['HEIGHT', '1324', 'mm', '132.4', 'cm', 'GUARDIAN_REPORTED'],
      ['MUAC', '17.5', 'cm', '17.5', 'cm', 'MEASURED'],
    ]);
    const row = await prisma.measurement.findFirstOrThrow({ where: { sessionId: s.id, type: 'WEIGHT' } });
    expect([row.value.toString(), row.recordedById, row.deviceMake]).toEqual([
      '24.35',
      fx.user.asha1,
      'Synthetic Scales',
    ]);
  });

  it('rejects invalid numbers, units, precision, impossible values and future times', async () => {
    const { s } = await sessionWithDiseases();
    const cases: Array<[object, number, string]> = [
      [{ value: 'NaN' }, 400, 'VALIDATION_ERROR'],
      [{ value: 'Infinity' }, 400, 'VALIDATION_ERROR'],
      [{ value: '-5' }, 400, 'VALIDATION_ERROR'],
      [{ value: 24.35 }, 400, 'VALIDATION_ERROR'],
      [{ type: 'HAEMOGLOBIN', unit: 'g/dL' }, 400, 'VALIDATION_ERROR'],
      [{ unit: 'cm' }, 422, 'INVALID_UNIT'],
      [{ value: '24.355' }, 422, 'TOO_MANY_DECIMALS'],
      [{ value: '400' }, 422, 'IMPLAUSIBLE_VALUE'],
      [{ measuredAt: new Date(clock.now().getTime() + 3_600_000).toISOString() }, 422, 'MEASURED_IN_FUTURE'],
      [{ recordedById: fx.user.asha5 }, 400, 'VALIDATION_ERROR'],
    ];
    for (const [extra, status, code] of cases) {
      const res = await (await as('asha1')).post(`/screenings/${s.id}/measurements`, measurement(s, extra));
      expect([res.status, res.body.error?.code], JSON.stringify(extra)).toEqual([status, code]);
    }
    expect(await prisma.measurement.count({ where: { sessionId: s.id } })).toBe(0);
  });

  it('corrects by superseding: the original stays in the history; corrected rows cannot be corrected again', async () => {
    let { s } = await sessionWithDiseases();
    s = session(await (await as('asha1')).post(`/screenings/${s.id}/measurements`, measurement(s)));
    const original = s.measurements[0]!;
    const body = () => ({ ...correction(s, { value: '24.53' }), correctionReason: 'Digits swapped' });
    const corrected = await (
      await as('asha1')
    ).post(`/screenings/${s.id}/measurements/${original.id}/corrections`, body());
    expect(corrected.status).toBe(201);
    s = session(corrected);
    expect(s.measurements.map((m) => [m.value, m.isCurrent, m.supersedesId, m.correctionReason])).toEqual([
      ['24.35', false, null, null],
      ['24.53', true, original.id, 'Digits swapped'],
    ]);
    const again = await (
      await as('asha1')
    ).post(`/screenings/${s.id}/measurements/${original.id}/corrections`, body());
    expect(again.body.error.code).toBe('MEASUREMENT_ALREADY_CORRECTED');
    const noReason = await (
      await as('asha1')
    ).post(`/screenings/${s.id}/measurements/${s.measurements[1]!.id}/corrections`, {
      ...correction(s),
    });
    expect(noReason.status).toBe(400);
    expect(
      await prisma.auditLog.count({ where: { entityId: s.id, action: 'screening.measurement_corrected' } }),
    ).toBe(1);
  });
});

// ====================================================================== lifecycle

describe('completion and cancellation', () => {
  async function completedSession() {
    const started = await sessionWithDiseases();
    const child = started.child;
    let s = session(await save(started.s, 'DISEASES', [yes(q('DISEASES', 'DEMO_Q1'))]));
    s = session(
      await (
        await as('asha1')
      ).patch(`/screenings/${s.id}/categories/DISEASES`, { expectedVersion: s.version, status: 'COMPLETED' }),
    );
    return { s, child };
  }

  it('refuses to complete an empty session or one without a completed category', async () => {
    const child = await newChild();
    const empty = session(await start(child.id));
    const res = await (
      await as('asha1')
    ).post(`/screenings/${empty.id}/complete`, { expectedVersion: empty.version });
    expect(res.body.error.code).toBe('NO_COMPLETED_CATEGORY');
    const { s } = await sessionWithDiseases();
    expect(
      (await (await as('asha1')).post(`/screenings/${s.id}/complete`, { expectedVersion: s.version })).body
        .error.code,
    ).toBe('NO_COMPLETED_CATEGORY');
  });

  it('completes once, keeps the original time on repeats, and keeps other categories incomplete / not assessed', async () => {
    let { s } = await completedSession();
    s = session(await startCategory(s, 'DEFICIENCIES')); // started, never finished
    clock.advance(60_000);
    const done = session(
      await (await as('asha1')).post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }),
    );
    expect(done).toMatchObject({ status: 'COMPLETED', canEdit: false });
    // Always in Four-D order (D2 before D3), whatever order they were started in.
    expect(done.sessionCategories.map((c) => [c.category, c.status])).toEqual([
      ['DEFICIENCIES', 'IN_PROGRESS'],
      ['DISEASES', 'COMPLETED'],
    ]);
    expect(done.categoriesNotAssessed).toEqual(['DEFECTS_AT_BIRTH', 'DEVELOPMENTAL_DELAYS_DISABILITIES']);

    clock.advance(60_000);
    const again = await (await as('asha1')).post(`/screenings/${s.id}/complete`, { expectedVersion: 1 });
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(session(again).completedAt).toBe(done.completedAt);
    expect(await prisma.auditLog.count({ where: { entityId: s.id, action: 'screening.completed' } })).toBe(1);
  });

  it('makes a completed session final for every change', async () => {
    let { s } = await completedSession();
    s = session(
      await (await as('asha1')).post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }),
    );
    const a = await as('asha1');
    for (const res of [
      await save(s, 'DISEASES', [yes(q('DISEASES', 'DEMO_Q1'))]),
      await startCategory(s, 'DEFICIENCIES'),
      await a.post(`/screenings/${s.id}/measurements`, measurement(s)),
      await a.post(`/screenings/${s.id}/cancel`, { expectedVersion: s.version, reason: 'Too late' }),
      await a.patch(`/screenings/${s.id}/categories/DISEASES`, { expectedVersion: s.version, notes: 'late' }),
    ]) {
      expect([res.status, res.body.error.code]).toEqual([409, 'SESSION_FINAL']);
    }
  });

  it('cancels with a reason and actor, without needing consent, and allows a new session', async () => {
    const { s, child } = await sessionWithDiseases();
    // Consent withdrawn mid-session: further screening is blocked, cancellation still works.
    await (
      await as('asha1')
    ).post(`/children/${child.id}/consents/${child.consentId}/withdraw`, {
      guardianId: child.mother,
      method: 'VERBAL_WITNESSED',
    });
    const blocked = await save(s, 'DISEASES', [yes(q('DISEASES', 'DEMO_Q1'))]);
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'CONSENT_REQUIRED']);
    expect(
      (await (await as('asha1')).post(`/screenings/${s.id}/cancel`, { expectedVersion: s.version })).status,
    ).toBe(400);
    const cancelled = session(
      await (
        await as('asha1')
      ).post(`/screenings/${s.id}/cancel`, { expectedVersion: s.version, reason: 'Consent withdrawn' }),
    );
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Consent withdrawn',
      cancelledByName: 'Synthetic asha1',
    });
    await consent(child.id, child.mother, 'GRANTED');
    expect((await start(child.id)).status).toBe(201);
  });
});

// ================================================================ authorization

describe('object-level authorization (IDOR / BOLA)', () => {
  it('hides sessions outside the caller area (404, audited) for every route', async () => {
    let { s } = await sessionWithDiseases();
    s = session(await (await as('asha1')).post(`/screenings/${s.id}/measurements`, measurement(s)));
    const m = s.measurements[0]!.id;
    const other = await as('asha5');
    for (const res of [
      await other.get(`/screenings/${s.id}`),
      await other.post(`/screenings/${s.id}/categories`, {
        expectedVersion: s.version,
        category: 'DEFICIENCIES',
      }),
      await other.post(`/screenings/${s.id}/categories/DISEASES/responses`, {
        expectedVersion: s.version,
        responses: [yes(q('DISEASES', 'DEMO_Q1'))],
      }),
      await other.post(`/screenings/${s.id}/measurements`, measurement(s)),
      await other.post(`/screenings/${s.id}/measurements/${m}/corrections`, {
        ...correction(s),
        correctionReason: 'xxx',
      }),
      await other.post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }),
      await other.post(`/screenings/${s.id}/cancel`, { expectedVersion: s.version, reason: 'xxx' }),
      await other.get(`/children/${s.childId}/screenings`),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(
      await prisma.auditLog.count({
        where: { action: 'screeningSession.access_denied', entityId: s.id, actorUserId: fx.user.asha5! },
      }),
    ).toBeGreaterThanOrEqual(7);
    const after = session(await (await as('asha1')).get(`/screenings/${s.id}`));
    expect([after.version, after.status, after.measurements.length]).toEqual([s.version, s.status, 1]);
  });

  it('lets other authorised users read but only the conducting worker write (decisions L, M)', async () => {
    const { s } = await sessionWithDiseases();
    const colleague = await as('ashaboth'); // same village, not the conductor
    const read = session(await colleague.get(`/screenings/${s.id}`));
    expect([read.isMine, read.canEdit]).toEqual([false, false]);
    const write = await colleague.post(`/screenings/${s.id}/categories/DISEASES/responses`, {
      expectedVersion: s.version,
      responses: [yes(q('DISEASES', 'DEMO_Q1'))],
    });
    expect([write.status, write.body.error.code]).toEqual([403, 'NOT_SESSION_OWNER']);
    expect(await prisma.auditLog.count({ where: { action: 'screening.write_denied', entityId: s.id } })).toBe(
      1,
    );

    expect((await (await as('sup1')).get(`/screenings/${s.id}`)).status).toBe(200); // child.read
    expect(
      (
        await (
          await as('sup1')
        ).post(`/screenings/${s.id}/cancel`, { expectedVersion: s.version, reason: 'xxx' })
      ).status,
    ).toBe(403);
    expect((await (await as('dadmin1')).get(`/screenings/${s.id}`)).status).toBe(403);
  });

  it('refuses a measurement id from another session (resource ownership mismatch)', async () => {
    let a = (await sessionWithDiseases()).s;
    a = session(await (await as('asha1')).post(`/screenings/${a.id}/measurements`, measurement(a)));
    const b = (await sessionWithDiseases()).s;
    const res = await (
      await as('asha1')
    ).post(`/screenings/${b.id}/measurements/${a.measurements[0]!.id}/corrections`, {
      ...correction(b),
      correctionReason: 'Wrong session',
    });
    expect(res.status).toBe(404);
  });
});

// ================================================================ concurrency

describe('concurrent and duplicate submissions', () => {
  it('two saves with the same version: exactly one wins, the other gets VERSION_CONFLICT', async () => {
    const { s } = await sessionWithDiseases();
    const [r1, r2] = await Promise.all([
      save(s, 'DISEASES', [yes(q('DISEASES', 'DEMO_Q1'), true)]),
      save(s, 'DISEASES', [yes(q('DISEASES', 'DEMO_Q1'), false)]),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const after = session(await (await as('asha1')).get(`/screenings/${s.id}`));
    expect(after.version).toBe(s.version + 1);
  });

  it('two completions at once both succeed with one completion time', async () => {
    let { s } = await sessionWithDiseases();
    s = session(await save(s, 'DISEASES', [yes(q('DISEASES', 'DEMO_Q1'))]));
    s = session(
      await (
        await as('asha1')
      ).patch(`/screenings/${s.id}/categories/DISEASES`, { expectedVersion: s.version, status: 'COMPLETED' }),
    );
    const a = await as('asha1');
    const [c1, c2] = await Promise.all([
      a.post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }),
      a.post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }),
    ]);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    expect(session(c1).completedAt).toBe(session(c2).completedAt);
    expect(await prisma.auditLog.count({ where: { entityId: s.id, action: 'screening.completed' } })).toBe(1);
  });

  it('two starts for one child with different submission ids create one session', async () => {
    const child = await newChild();
    const results = await Promise.all([start(child.id), start(child.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.screeningSession.count({ where: { childId: child.id } })).toBe(1);
  });
});

// ======================================================= lists, history, summary

describe('lists, history and the dashboard summary', () => {
  it('lists only sessions in scope, with filters and pagination', async () => {
    const { s } = await sessionWithDiseases();
    const mine = screeningListResponseSchema.parse(
      (await (await as('asha1')).get('/screenings?mine=true&status=IN_PROGRESS&pageSize=50')).body,
    );
    expect(mine.items.some((i) => i.id === s.id)).toBe(true);
    expect(mine.items.every((i) => i.isMine && i.status === 'IN_PROGRESS')).toBe(true);
    const outside = screeningListResponseSchema.parse((await (await as('asha5')).get('/screenings')).body);
    expect(outside.items.some((i) => i.id === s.id)).toBe(false);
    const page = screeningListResponseSchema.parse(
      (await (await as('asha1')).get('/screenings?page=1&pageSize=2')).body,
    );
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
    for (const bad of ['?pageSize=500', '?sort=startedAt', '?status=DONE', '?mine=yes']) {
      expect((await (await as('asha1')).get(`/screenings${bad}`)).status).toBe(400);
    }
  });

  it("returns a child's history newest first, including cancelled and completed sessions", async () => {
    const child = await newChild();
    const first = session(await start(child.id));
    await (
      await as('asha1')
    ).post(`/screenings/${first.id}/cancel`, { expectedVersion: 1, reason: 'Child unwell' });
    clock.advance(1000);
    const second = session(await start(child.id));
    const history = screeningListResponseSchema.parse(
      (await (await as('asha1')).get(`/children/${child.id}/screenings`)).body,
    );
    expect(history.items.map((i) => [i.id, i.status])).toEqual([
      [second.id, 'DRAFT'],
      [first.id, 'CANCELLED'],
    ]);
  });

  it("counts the caller's own drafts, in-progress and today's completed sessions", async () => {
    const before = screeningDashboardSummarySchema.parse(
      (await (await as('asha1')).get('/screenings/summary')).body,
    );
    const child = await newChild();
    await start(child.id);
    const after = screeningDashboardSummarySchema.parse(
      (await (await as('asha1')).get('/screenings/summary')).body,
    );
    expect(after.drafts).toBe(before.drafts + 1);
    expect(after.date).toBe('2026-11-21');
    const other = screeningDashboardSummarySchema.parse(
      (await (await as('asha5')).get('/screenings/summary')).body,
    );
    expect(other).toMatchObject({ completedToday: 0, inProgress: 0, drafts: 0 });
    expect((await (await as('sup1')).get('/screenings/summary')).status).toBe(403);
  });
});

describe('rate limiting', () => {
  it('applies the shared per-user child-data write limit to screening writes', async () => {
    app = makeApp(3);
    tokens.clear();
    const child = await newChild(false); // 1 write (child registration)
    await start(child.id); // 2 (403: no consent, still counted)
    await start(child.id); // 3
    const limited = await start(child.id);
    expect(limited.status).toBe(429);
    app = makeApp();
    tokens.clear();
  });
});
