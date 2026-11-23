import { randomUUID } from 'node:crypto';
import {
  amendmentQueueResponseSchema,
  childDetailResponseSchema,
  screeningProtocolDetailResponseSchema,
  screeningSessionResponseSchema,
  type ScreeningSessionDetail,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { ensureConsentTemplates } from '../../src/modules/consent/consentNotices';
import { ensureDemoProtocols } from '../../src/modules/screening/demoProtocols';
import { testAuthConfig } from './authFixture';
import { api, buildAuthzFixture, TestClock, tokenFor, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 6G-1: amendments of COMPLETED screenings through the real HTTP API and database.
 * Users (tests/db/authzFixture.ts): asha1 conducts (V1); ashaboth also works in V1; sup1 has
 * child.read only; asha5 is in another district; mht1 (created here) is a medical officer in V1.
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createApp>;
const tokens = new Map<string, string>();
const questions = new Map<string, Record<string, string>>();
const DAY = 24 * 60 * 60 * 1000;

async function as(login: string) {
  if (!tokens.has(login)) tokens.set(login, await tokenFor(app, login));
  return api(app, tokens.get(login)!);
}
/** After moving the clock, access tokens expire: sign in again. */
function advance(ms: number) {
  clock.advance(ms);
  tokens.clear();
}
const q = (category: string, code: string) => questions.get(category)![code]!;
function session(res: request.Response): ScreeningSessionDetail {
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return screeningSessionResponseSchema.parse(res.body).session;
}

let seq = 0;
const letters = 'abcdefghijklmnopqrstuvwxyz';
async function newChild() {
  seq += 1;
  const res = await (
    await as('asha1')
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: `Synthetic Amended ${letters[seq % 26]}${letters[(seq * 7) % 26]}${letters[(seq * 3) % 26]}`,
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
  const template = await prisma.consentTemplate.findFirstOrThrow({
    where: { purpose: 'SCREENING', version: 1, languageCode: 'hi' },
  });
  const consent = await (
    await as('asha1')
  ).post(`/children/${child.id}/consents`, {
    clientOperationId: randomUUID(),
    guardianId: child.guardians[0]!.guardianId,
    purpose: 'SCREENING',
    decision: 'GRANTED',
    method: 'SIGNATURE',
    templateId: template.id,
  });
  expect(consent.status).toBe(201);
  return {
    id: child.id,
    mother: child.guardians[0]!.guardianId,
    consentId: consent.body.consent.id as string,
  };
}

/** A COMPLETED screening by asha1: DISEASES finished (Q1 yes, Q2 = 5, Q3 text + note), one weight. */
async function completedSession(options: { complete?: boolean } = {}) {
  const child = await newChild();
  const a = await as('asha1');
  let s = session(await a.post('/screenings', { clientOperationId: randomUUID(), childId: child.id }));
  s = session(
    await a.post(`/screenings/${s.id}/categories`, { expectedVersion: s.version, category: 'DISEASES' }),
  );
  s = session(
    await a.post(`/screenings/${s.id}/categories/DISEASES/responses`, {
      expectedVersion: s.version,
      responses: [
        { questionId: q('DISEASES', 'DEMO_Q1'), status: 'ANSWERED', source: 'WORKER_OBSERVED', value: true },
        { questionId: q('DISEASES', 'DEMO_Q2'), status: 'ANSWERED', source: 'WORKER_OBSERVED', value: 5 },
        {
          questionId: q('DISEASES', 'DEMO_Q3'),
          status: 'ANSWERED',
          source: 'GUARDIAN_REPORTED',
          value: 'Original synthetic text',
          notes: 'Original synthetic note',
        },
      ],
    }),
  );
  s = session(
    await a.patch(`/screenings/${s.id}/categories/DISEASES`, {
      expectedVersion: s.version,
      status: 'COMPLETED',
    }),
  );
  s = session(
    await a.post(`/screenings/${s.id}/measurements`, {
      expectedVersion: s.version,
      type: 'WEIGHT',
      value: '24.35',
      unit: 'kg',
      source: 'MEASURED',
      quality: 'RELIABLE',
      measuredAt: clock.now().toISOString(),
    }),
  );
  if (options.complete !== false) {
    s = session(await a.post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }));
  }
  return { child, s };
}

function amend(login: string, s: ScreeningSessionDetail, changes: object[], extra: object = {}) {
  return as(login).then((client) =>
    client.post(`/screenings/${s.id}/amendments`, {
      clientOperationId: randomUUID(),
      expectedSequence: s.amendments.length,
      reason: 'Synthetic correction of a typing mistake',
      changes,
      ...extra,
    }),
  );
}
const yesToNo = {
  kind: 'RESPONSE',
  category: 'DISEASES',
  status: 'ANSWERED',
  source: 'WORKER_OBSERVED',
  value: false,
};

/** Everything stored for the original version, to prove it never changes. */
async function originalSnapshot(sessionId: string) {
  return JSON.stringify({
    session: await prisma.screeningSession.findUniqueOrThrow({ where: { id: sessionId } }),
    categories: await prisma.screeningSessionCategory.findMany({
      where: { sessionId },
      orderBy: { id: 'asc' },
    }),
    observations: await prisma.screeningObservation.findMany({
      where: { sessionId },
      orderBy: { id: 'asc' },
    }),
    measurements: await prisma.measurement.findMany({ where: { sessionId }, orderBy: { id: 'asc' } }),
  });
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  app = createApp({
    auth: {
      db: prisma,
      config: testAuthConfig,
      now: clock.now,
      rateLimits: {
        ...DEFAULT_RATE_LIMITS,
        loginPerIpAndAccount: 10_000,
        loginPerIp: 10_000,
        childDataReadPerUser: 10_000,
        childDataWritePerUser: 10_000,
      },
    },
    consentPolicy: { allowDraftNotices: true },
    screeningPolicy: { allowDraftProtocols: true },
  });
  fx = await buildAuthzFixture(prisma, clock);
  expect(await ensureConsentTemplates(prisma)).toEqual([]);
  expect(await ensureDemoProtocols(prisma)).toEqual([]);
  // A medical officer (screening.review) in V1. Open-ended assignment, so it survives clock moves.
  const asha = await prisma.user.findUniqueOrThrow({ where: { id: fx.user.asha1! } });
  const mht = await prisma.user.create({
    data: {
      loginId: 'MHT1',
      passwordHash: asha.passwordHash,
      displayName: 'Synthetic Medical Officer',
      mustChangePassword: false,
    },
  });
  fx.user.mht1 = mht.id;
  await prisma.workerAreaAssignment.create({
    data: {
      userId: mht.id,
      areaId: fx.area.V1!,
      roleId: fx.role.MHT_MEDICAL_OFFICER!,
      scope: 'AREA_ONLY',
      effectiveFrom: new Date(clock.now().getTime() - 1000),
      createdById: fx.user.stateadmin!,
    },
  });
  for (const p of await prisma.screeningProtocol.findMany({ where: { isDemonstration: true } })) {
    const res = await (await as('asha1')).get(`/screening-protocols/${p.id}`);
    const detail = screeningProtocolDetailResponseSchema.parse(res.body).protocol;
    questions.set(p.category, Object.fromEntries(detail.questions.map((x) => [x.code, x.id])));
  }
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

// ===================================================================== versioning

describe('versioning: amendments never change the original', () => {
  it('adds version 2 with old and new values, shows the current value, keeps the original byte for byte', async () => {
    const { s } = await completedSession();
    expect([s.currentVersion, s.canAmend, s.amendBasis]).toEqual([1, true, 'CONDUCTOR_WITHIN_WINDOW']);
    const before = await originalSnapshot(s.id);

    const res = await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]);
    expect(res.status).toBe(201);
    const after = session(res);
    expect(after.currentVersion).toBe(2);
    const answer = after.sessionCategories[0]!.responses.find((r) => r.questionCode === 'DEMO_Q1')!;
    expect([answer.value, answer.amended]).toEqual([false, true]);
    expect(after.amendments).toHaveLength(1);
    expect(after.amendments[0]).toMatchObject({
      sequence: 1,
      version: 2,
      basis: 'CONDUCTOR_WITHIN_WINDOW',
      reason: 'Synthetic correction of a typing mistake',
      amendedByName: 'Synthetic asha1',
      clinicallySignificant: true,
      reviewStatus: 'PENDING',
    });
    expect(after.amendments[0]!.changes[0]).toMatchObject({
      kind: 'RESPONSE',
      category: 'DISEASES',
      questionCode: 'DEMO_Q1',
      oldValue: { status: 'ANSWERED', value: true, source: 'WORKER_OBSERVED' },
      newValue: { status: 'ANSWERED', value: false, source: 'WORKER_OBSERVED' },
    });
    expect(await originalSnapshot(s.id)).toBe(before);
  });

  it('chains versions: the second amendment of the same answer records version 2 as its old value', async () => {
    const { s } = await completedSession();
    const v2 = session(await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]));
    const v3 = session(
      await amend('asha1', v2, [
        {
          kind: 'RESPONSE',
          category: 'DISEASES',
          questionId: q('DISEASES', 'DEMO_Q1'),
          status: 'UNKNOWN',
          source: 'GUARDIAN_REPORTED',
        },
      ]),
    );
    expect(v3.currentVersion).toBe(3);
    expect(v3.amendments.map((a) => [a.sequence, a.version])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(v3.amendments[1]!.changes[0]).toMatchObject({
      oldValue: { status: 'ANSWERED', value: false },
      newValue: { status: 'UNKNOWN', value: null, source: 'GUARDIAN_REPORTED' },
    });
    const current = v3.sessionCategories[0]!.responses.find((r) => r.questionCode === 'DEMO_Q1')!;
    expect([current.status, current.value]).toEqual(['UNKNOWN', null]);
    expect(v3.sessionCategories[0]!.completeness).toMatchObject({ answered: 2, unknown: 1, notAnswered: 0 });
  });

  it('amends a measurement and area notes; notes-only changes need no review', async () => {
    const { s } = await completedSession();
    const m = s.measurements[0]!;
    const notes = session(
      await amend('asha1', s, [
        { kind: 'CATEGORY_NOTES', category: 'DISEASES', notes: 'Synthetic added observation' },
      ]),
    );
    expect(notes.amendments[0]).toMatchObject({ clinicallySignificant: false, reviewStatus: 'NOT_REQUIRED' });
    expect([notes.sessionCategories[0]!.notes, notes.sessionCategories[0]!.notesAmended]).toEqual([
      'Synthetic added observation',
      true,
    ]);
    const weight = session(
      await amend('asha1', notes, [
        {
          kind: 'MEASUREMENT',
          measurementId: m.id,
          value: '24.53',
          unit: 'kg',
          source: 'MEASURED',
          quality: 'RELIABLE',
          measuredAt: m.measuredAt,
        },
      ]),
    );
    expect(weight.measurements[0]).toMatchObject({ value: '24.53', amended: true, isCurrent: true });
    expect(weight.amendments[1]!.changes[0]).toMatchObject({
      kind: 'MEASUREMENT',
      oldValue: { value: '24.35', unit: 'kg' },
      newValue: { value: '24.53', unit: 'kg' },
      clinicallySignificant: true,
    });
    const row = await prisma.measurement.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.value.toString()).toBe('24.35'); // the stored original is untouched
  });

  it('can answer a question that was left unanswered (old value = none), but not start a new area', async () => {
    // A screening where only the required DISEASES question was answered.
    const child = await newChild();
    const a = await as('asha1');
    let s = session(await a.post('/screenings', { clientOperationId: randomUUID(), childId: child.id }));
    s = session(
      await a.post(`/screenings/${s.id}/categories`, { expectedVersion: s.version, category: 'DISEASES' }),
    );
    s = session(
      await a.post(`/screenings/${s.id}/categories/DISEASES/responses`, {
        expectedVersion: s.version,
        responses: [
          {
            questionId: q('DISEASES', 'DEMO_Q1'),
            status: 'ANSWERED',
            source: 'WORKER_OBSERVED',
            value: true,
          },
        ],
      }),
    );
    s = session(
      await a.patch(`/screenings/${s.id}/categories/DISEASES`, {
        expectedVersion: s.version,
        status: 'COMPLETED',
      }),
    );
    s = session(await a.post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }));
    expect(s.sessionCategories[0]!.completeness.notAnswered).toBe(2);

    const v2 = session(
      await amend('asha1', s, [
        {
          kind: 'RESPONSE',
          category: 'DISEASES',
          questionId: q('DISEASES', 'DEMO_Q2'),
          status: 'ANSWERED',
          source: 'WORKER_OBSERVED',
          value: 7,
        },
      ]),
    );
    expect(v2.amendments[0]!.changes[0]).toMatchObject({
      oldValue: null,
      newValue: { status: 'ANSWERED', value: 7 },
    });
    expect(v2.sessionCategories[0]!.completeness.notAnswered).toBe(1);

    const newArea = await amend('asha1', v2, [
      {
        kind: 'RESPONSE',
        category: 'DEFICIENCIES',
        questionId: q('DEFICIENCIES', 'DEMO_Q1'),
        status: 'UNKNOWN',
        source: 'WORKER_OBSERVED',
      },
    ]);
    expect([newArea.status, newArea.body.error.code]).toEqual([422, 'CATEGORY_NOT_IN_SCREENING']);
  });
});

// =================================================================== permissions

describe('permissions', () => {
  it('only the conductor or a medical officer may amend; others are refused (audited)', async () => {
    const { s } = await completedSession();
    const change = [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }];
    const colleague = await amend('ashaboth', s, change);
    expect([colleague.status, colleague.body.error.code]).toEqual([403, 'AMENDMENT_NOT_ALLOWED']);
    expect((await amend('sup1', s, change)).status).toBe(403); // no screening.conduct / review
    expect((await amend('dadmin1', s, change)).status).toBe(403);
    const outside = await amend('asha5', s, change);
    expect(outside.status).toBe(404);
    expect(
      await prisma.auditLog.count({
        where: { action: 'screening.amendment_denied', entityId: s.id, actorUserId: fx.user.ashaboth! },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'screeningSession.access_denied', entityId: s.id, actorUserId: fx.user.asha5! },
      }),
    ).toBeGreaterThan(0);
    expect(await prisma.screeningAmendment.count({ where: { sessionId: s.id } })).toBe(0);
  });

  it('refuses screenings that are in progress or cancelled', async () => {
    const open = await completedSession({ complete: false });
    const res = await amend('asha1', open.s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]);
    expect([res.status, res.body.error.code]).toEqual([409, 'SESSION_NOT_COMPLETED']);
    const cancelled = session(
      await (
        await as('asha1')
      ).post(`/screenings/${open.s.id}/cancel`, { expectedVersion: open.s.version, reason: 'Synthetic' }),
    );
    const again = await amend('asha1', cancelled, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]);
    expect([again.status, again.body.error.code]).toEqual([409, 'SESSION_NOT_COMPLETED']);
  });

  it('refuses forged or mismatched ids, unchanged values, duplicates and a missing reason', async () => {
    const { s } = await completedSession();
    const other = await completedSession();
    const cases: Array<[object[], object, number, string]> = [
      [[{ ...yesToNo, questionId: q('DEFECTS_AT_BIRTH', 'DEMO_Q1') }], {}, 422, 'QUESTION_NOT_IN_PROTOCOL'],
      [[{ ...yesToNo, questionId: randomUUID() }], {}, 422, 'QUESTION_NOT_IN_PROTOCOL'],
      [
        [
          {
            kind: 'MEASUREMENT',
            measurementId: other.s.measurements[0]!.id,
            value: '20',
            unit: 'kg',
            source: 'MEASURED',
            quality: 'RELIABLE',
            measuredAt: clock.now().toISOString(),
          },
        ],
        {},
        422,
        'MEASUREMENT_NOT_IN_SCREENING',
      ],
      [[{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1'), value: true }], {}, 422, 'AMENDMENT_UNCHANGED'],
      [
        [
          { ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') },
          { ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') },
        ],
        {},
        422,
        'DUPLICATE_CHANGE',
      ],
      [[{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1'), value: 'yes' }], {}, 422, 'INVALID_RESPONSE'],
      [[{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }], { reason: '  ' }, 400, 'VALIDATION_ERROR'],
      [
        [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }],
        { amendedById: fx.user.mht1 },
        400,
        'VALIDATION_ERROR',
      ],
      [[], {}, 400, 'VALIDATION_ERROR'],
    ];
    for (const [changes, extra, status, code] of cases) {
      const res = await amend('asha1', s, changes, extra);
      expect([res.status, res.body.error?.code], JSON.stringify(changes)).toEqual([status, code]);
    }
    expect(await prisma.screeningAmendment.count({ where: { sessionId: s.id } })).toBe(0);
  });

  it('lets consent withdrawal after completion not block a correction (decision G8)', async () => {
    const { child, s } = await completedSession();
    await (
      await as('asha1')
    ).post(`/children/${child.id}/consents/${child.consentId}/withdraw`, {
      guardianId: child.mother,
      method: 'SIGNATURE',
    });
    expect((await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }])).status).toBe(
      201,
    );
  });
});

// ================================================================ the 7-day window

describe('7-day limit for the conducting worker', () => {
  it('allows the conductor until just before 7 x 24 h, then only a medical officer', async () => {
    const { s } = await completedSession();
    const completedAt = new Date(s.completedAt!).getTime();
    expect(s.amendableUntil).toBe(new Date(completedAt + 7 * DAY).toISOString());

    advance(7 * DAY - 1000); // 1 second before the end
    const inTime = await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]);
    expect(inTime.status).toBe(201);
    const v2 = session(inTime);

    advance(1000); // exactly 7 x 24 h after completion: the window has closed
    const late = await amend('asha1', v2, [
      {
        kind: 'RESPONSE',
        category: 'DISEASES',
        questionId: q('DISEASES', 'DEMO_Q1'),
        status: 'UNKNOWN',
        source: 'WORKER_OBSERVED',
      },
    ]);
    expect([late.status, late.body.error.code]).toEqual([403, 'AMENDMENT_NOT_ALLOWED']);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'screening.amendment_denied', entityId: s.id, actorUserId: fx.user.asha1! },
    });
    expect(audit.details).toEqual({ reason: 'WINDOW_EXPIRED' });
    const seen = session(await (await as('asha1')).get(`/screenings/${s.id}`));
    expect([seen.canAmend, seen.amendBasis]).toEqual([false, null]);

    advance(30 * DAY); // a medical officer has no time limit
    const mo = await amend('mht1', v2, [
      {
        kind: 'RESPONSE',
        category: 'DISEASES',
        questionId: q('DISEASES', 'DEMO_Q1'),
        status: 'UNKNOWN',
        source: 'WORKER_OBSERVED',
      },
    ]);
    expect(mo.status).toBe(201);
    expect(session(mo).amendments[1]).toMatchObject({
      basis: 'MEDICAL_OFFICER',
      amendedByName: 'Synthetic Medical Officer',
    });
  });
});

// =================================================================== concurrency

describe('concurrent and repeated amendments', () => {
  it('two amendments at the same version: exactly one wins, the other must reload', async () => {
    const { s } = await completedSession();
    const [a, b] = await Promise.all([
      amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]),
      amend('mht1', s, [
        { kind: 'CATEGORY_NOTES', category: 'DISEASES', notes: 'Synthetic concurrent note' },
      ]),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toMatchObject({ code: 'AMENDMENT_CONFLICT', details: { currentSequence: 1 } });
    expect(await prisma.screeningAmendment.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it('a stale expected sequence is refused; a retry with the same id returns the first amendment', async () => {
    const { s } = await completedSession();
    const op = randomUUID();
    const first = await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }], {
      clientOperationId: op,
    });
    expect(first.status).toBe(201);
    const retry = await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }], {
      clientOperationId: op,
    });
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replay']).toBe('true');
    const stale = await amend('asha1', s, [
      { kind: 'CATEGORY_NOTES', category: 'DISEASES', notes: 'Synthetic stale' },
    ]);
    expect([stale.status, stale.body.error.code]).toEqual([409, 'AMENDMENT_CONFLICT']);
    expect(await prisma.screeningAmendment.count({ where: { sessionId: s.id } })).toBe(1);
  });
});

// ======================================================================== review

describe('medical officer review of significant amendments', () => {
  it('lists pending amendments for the reviewer, records the review once, and shows self-review', async () => {
    const { s } = await completedSession();
    const v2 = session(await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]));
    const amendmentId = v2.amendments[0]!.id;

    const queue = amendmentQueueResponseSchema.parse(
      (await (await as('mht1')).get('/screening-amendments')).body,
    );
    expect(queue.items.some((i) => i.amendmentId === amendmentId)).toBe(true);
    expect((await (await as('asha1')).get('/screening-amendments')).status).toBe(403);
    expect(
      (await (await as('asha1')).post(`/screenings/${s.id}/amendments/${amendmentId}/review`, {})).status,
    ).toBe(403);

    const reviewed = session(
      await (
        await as('mht1')
      ).post(`/screenings/${s.id}/amendments/${amendmentId}/review`, {
        notes: 'Synthetic: checked with the family',
      }),
    );
    expect(reviewed.amendments[0]).toMatchObject({
      reviewStatus: 'REVIEWED',
      reviewedByName: 'Synthetic Medical Officer',
      reviewNotes: 'Synthetic: checked with the family',
      selfReviewed: false,
    });
    const twice = await (await as('mht1')).post(`/screenings/${s.id}/amendments/${amendmentId}/review`, {});
    expect([twice.status, twice.body.error.code]).toEqual([409, 'AMENDMENT_NOT_PENDING']);

    // A medical officer's own amendment is still pending (decision G6); confirming it is "self-reviewed".
    const own = session(
      await amend('mht1', reviewed, [
        {
          kind: 'RESPONSE',
          category: 'DISEASES',
          questionId: q('DISEASES', 'DEMO_Q2'),
          status: 'ANSWERED',
          source: 'WORKER_OBSERVED',
          value: 6,
        },
      ]),
    );
    expect(own.amendments[1]!.reviewStatus).toBe('PENDING');
    const self = session(
      await (await as('mht1')).post(`/screenings/${s.id}/amendments/${own.amendments[1]!.id}/review`, {}),
    );
    expect(self.amendments[1]!.selfReviewed).toBe(true);
  });

  it('cannot review an amendment through another screening, or one that needs no review', async () => {
    const one = await completedSession();
    const two = await completedSession();
    const v2 = session(await amend('asha1', one.s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]));
    expect(
      (await (await as('mht1')).post(`/screenings/${two.s.id}/amendments/${v2.amendments[0]!.id}/review`, {}))
        .status,
    ).toBe(404);
    const notes = session(
      await amend('asha1', v2, [{ kind: 'CATEGORY_NOTES', category: 'DISEASES', notes: 'Synthetic' }]),
    );
    const res = await (
      await as('mht1')
    ).post(`/screenings/${one.s.id}/amendments/${notes.amendments[1]!.id}/review`, {});
    expect([res.status, res.body.error.code]).toEqual([409, 'AMENDMENT_NOT_PENDING']);
  });
});

// ================================================================= audit, privacy

describe('audit, encryption and referral flags', () => {
  it('audits every amendment and review with identifiers only; stores reason and free text encrypted', async () => {
    const { s } = await completedSession();
    const v2 = session(
      await amend(
        'asha1',
        s,
        [
          {
            kind: 'RESPONSE',
            category: 'DISEASES',
            questionId: q('DISEASES', 'DEMO_Q3'),
            status: 'ANSWERED',
            source: 'GUARDIAN_REPORTED',
            value: 'SECRET-NEW-TEXT',
            notes: 'SECRET-NEW-NOTE',
          },
        ],
        { reason: 'SECRET-REASON for the change' },
      ),
    );
    await (
      await as('mht1')
    ).post(`/screenings/${s.id}/amendments/${v2.amendments[0]!.id}/review`, { notes: 'SECRET-REVIEW' });
    const audit = await prisma.auditLog.findMany({
      where: { entityId: s.id, action: { startsWith: 'screening.amend' } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual(['screening.amended', 'screening.amendment_reviewed']);
    expect(JSON.stringify(audit)).not.toMatch(/SECRET|Original synthetic/);

    const stored = await prisma.screeningAmendment.findFirstOrThrow({
      where: { sessionId: s.id },
      include: { changes: true },
    });
    expect(stored.reason).toMatch(/^enc1:/);
    expect(stored.reviewNotes).toMatch(/^enc1:/);
    const raw = JSON.stringify(stored);
    expect(raw).not.toMatch(/SECRET|Original synthetic/);
    // ... while the authorised reader sees plaintext old and new values.
    expect(v2.amendments[0]!.changes[0]).toMatchObject({
      oldValue: { value: 'Original synthetic text', notes: 'Original synthetic note' },
      newValue: { value: 'SECRET-NEW-TEXT', notes: 'SECRET-NEW-NOTE' },
    });
    expect(v2.amendments[0]!.reason).toBe('SECRET-REASON for the change');
  });

  it('flags referrals made from the earlier version for reassessment without changing them', async () => {
    const { s } = await completedSession();
    const facility = await prisma.facility.create({
      data: { name: 'Synthetic CHC', type: 'CHC', areaId: fx.area.D1! },
    });
    const referral = await prisma.referral.create({
      data: {
        childId: s.childId,
        sessionId: s.id,
        facilityId: facility.id,
        areaId: fx.area.V1!,
        urgency: 'ROUTINE',
        createdById: fx.user.asha1!,
      },
    });
    const v2 = session(await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]));
    expect(v2.amendments[0]!.referralsFlagged).toBe(1);
    const flag = await prisma.screeningAmendmentReferralImpact.findFirstOrThrow({
      where: { referralId: referral.id },
    });
    expect(flag).toMatchObject({ reassessmentStatus: 'PENDING', referralStatusAtAmendment: 'CREATED' });
    expect(await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } })).toEqual(referral);
  });
});

// ============================================================== database rules

describe('database rules (apply to every account)', () => {
  it('amendments and changes are append-only; changes cannot be added to an old amendment', async () => {
    const { s } = await completedSession();
    const v2 = session(await amend('asha1', s, [{ ...yesToNo, questionId: q('DISEASES', 'DEMO_Q1') }]));
    const id = v2.amendments[0]!.id;
    await expect(
      prisma.screeningAmendment.update({ where: { id }, data: { reason: 'enc1:rewritten' } }),
    ).rejects.toThrow();
    await expect(prisma.screeningAmendment.delete({ where: { id } })).rejects.toThrow();
    const change = await prisma.screeningAmendmentChange.findFirstOrThrow({ where: { amendmentId: id } });
    await expect(
      prisma.screeningAmendmentChange.update({ where: { id: change.id }, data: { newValue: {} } }),
    ).rejects.toThrow();
    await expect(prisma.screeningAmendmentChange.delete({ where: { id: change.id } })).rejects.toThrow();
    await expect(
      prisma.screeningAmendmentChange.create({
        data: {
          amendmentId: id,
          kind: 'CATEGORY_NOTES',
          sessionCategoryId: change.sessionCategoryId,
          newValue: { notes: null },
          clinicallySignificant: false,
        },
      }),
    ).rejects.toThrow();
  });

  it('only a completed screening can be amended, and only with the next sequence', async () => {
    const open = await completedSession({ complete: false });
    const base = {
      amendedById: fx.user.asha1!,
      amendedAt: clock.now(),
      basis: 'CONDUCTOR_WITHIN_WINDOW' as const,
      reason: 'enc1:x',
      clinicallySignificant: false,
      reviewStatus: 'NOT_REQUIRED' as const,
    };
    await expect(
      prisma.screeningAmendment.create({ data: { ...base, sessionId: open.s.id, sequence: 1 } }),
    ).rejects.toThrow();
    const { s } = await completedSession();
    await expect(
      prisma.screeningAmendment.create({ data: { ...base, sessionId: s.id, sequence: 2 } }),
    ).rejects.toThrow();
    await expect(
      prisma.screeningAmendment.create({
        data: { ...base, sessionId: s.id, sequence: 1, reviewStatus: 'PENDING' },
      }),
    ).rejects.toThrow(); // significance and review status must match
  });
});
