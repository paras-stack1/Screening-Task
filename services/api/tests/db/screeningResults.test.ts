import { randomUUID } from 'node:crypto';
import {
  childDetailResponseSchema,
  clinicalRuleSetDefinitionSchema,
  generateResultResponseSchema,
  resultListResponseSchema,
  screeningProtocolDetailResponseSchema,
  screeningSessionResponseSchema,
  sessionResultsResponseSchema,
  type ScreeningSessionDetail,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { ensureDemoRuleSets } from '../../src/modules/clinical-rules/demoRuleSets';
import { chooseRuleSet } from '../../src/modules/clinical-rules/resultGeneration';
import { changeRuleSetStatus, importRuleSet } from '../../src/modules/clinical-rules/ruleSetLifecycle';
import { ensureConsentTemplates } from '../../src/modules/consent/consentNotices';
import { ensureDemoProtocols } from '../../src/modules/screening/demoProtocols';
import { testAuthConfig } from './authFixture';
import { api, buildAuthzFixture, TestClock, tokenFor, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 7 stage 7B: result generation, results API, rule-set lifecycle and the Step 7 database
 * rules, through the real HTTP API and database. All rules and content are SYNTHETIC.
 * Users (authzFixture): asha1 conducts in V1; asha5 works in another district; sup1 has
 * child.read (no screening.conduct / review); mht1 (created here) is a medical officer in V1.
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createApp>;
const tokens = new Map<string, string>();
const questions = new Map<string, Record<string, string>>();

async function as(login: string) {
  if (!tokens.has(login)) tokens.set(login, await tokenFor(app, login));
  return api(app, tokens.get(login)!);
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
    fullName: `Synthetic Result ${letters[seq % 26]}${letters[(seq * 7) % 26]}${letters[(seq * 3) % 26]}`,
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
  return child.id;
}

/**
 * A screening by asha1: DISEASES with Q1 answered `q1` and finished; DEVELOPMENTAL started but
 * left unfinished. `complete: false` leaves it open; `cancel: true` cancels it.
 */
async function screening(options: { q1?: boolean | 'UNKNOWN'; complete?: boolean; cancel?: boolean } = {}) {
  const childId = await newChild();
  const a = await as('asha1');
  let s = session(await a.post('/screenings', { clientOperationId: randomUUID(), childId }));
  s = session(
    await a.post(`/screenings/${s.id}/categories`, { expectedVersion: s.version, category: 'DISEASES' }),
  );
  const q1 = options.q1 ?? true;
  s = session(
    await a.post(`/screenings/${s.id}/categories/DISEASES/responses`, {
      expectedVersion: s.version,
      responses: [
        q1 === 'UNKNOWN'
          ? { questionId: q('DISEASES', 'DEMO_Q1'), status: 'UNKNOWN', source: 'GUARDIAN_REPORTED' }
          : {
              questionId: q('DISEASES', 'DEMO_Q1'),
              status: 'ANSWERED',
              source: 'WORKER_OBSERVED',
              value: q1,
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
    await a.post(`/screenings/${s.id}/categories`, {
      expectedVersion: s.version,
      category: 'DEVELOPMENTAL_DELAYS_DISABILITIES',
    }),
  );
  if (options.cancel) {
    s = session(
      await a.post(`/screenings/${s.id}/cancel`, { expectedVersion: s.version, reason: 'Synthetic stop' }),
    );
  } else if (options.complete !== false) {
    s = session(await a.post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }));
  }
  return s;
}

async function results(login: string, sessionId: string) {
  const res = await (await as(login)).get(`/screenings/${sessionId}/results`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return sessionResultsResponseSchema.parse(res.body);
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

// ===================================================================== generation

describe('result generation on completion', () => {
  it('without any rule set: observations only (NOT_INTERPRETED), never a reassuring outcome', async () => {
    expect(await prisma.clinicalRuleSet.count()).toBe(0);
    const s = await screening({ q1: false });
    const { current, history } = await results('asha1', s.id);
    expect(history).toHaveLength(1);
    expect(current).toMatchObject({ screeningVersion: 1, isCurrent: true, generatedByName: null });
    const byCategory = Object.fromEntries(current!.categories.map((c) => [c.category, c]));
    expect(byCategory.DISEASES).toMatchObject({ outcome: 'NOT_INTERPRETED', ruleSet: null, rules: [] });
    expect(byCategory.DISEASES!.limitations).toContainEqual({ code: 'NO_USABLE_RULE_SET' });
    expect(byCategory.DEVELOPMENTAL_DELAYS_DISABILITIES!.outcome).toBe('NOT_INTERPRETED');
    expect(byCategory.DEFECTS_AT_BIRTH!.outcome).toBe('NOT_ASSESSED');
    expect(current!.overallOutcome).toBe('NOT_INTERPRETED');
    expect(current!.usesUnapprovedContent).toBe(true);
  });

  it('creates a pending clinical review task and an audit record without answers', async () => {
    const s = await screening();
    const run = await prisma.screeningResultRun.findFirstOrThrow({
      where: { sessionId: s.id },
      include: { review: { include: { events: true } } },
    });
    expect(run.review).toMatchObject({ status: 'PENDING_REVIEW', areaId: fx.area.V1 });
    expect(run.review!.events).toMatchObject([
      { fromStatus: null, toStatus: 'PENDING_REVIEW', actorId: null },
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'screening.result_generated', entityId: run.id },
    });
    expect(audit.details).toMatchObject({ sessionId: s.id, screeningVersion: 1, trigger: 'automatic' });
    expect(JSON.stringify(audit.details)).not.toMatch(/value|notes|Synthetic Result/);
  });

  it('an open screening has no result', async () => {
    const s = await screening({ complete: false });
    expect((await results('asha1', s.id)).current).toBeNull();
  });
});

describe('with demonstration rule sets (outside production only)', () => {
  beforeAll(async () => {
    await ensureDemoRuleSets(prisma);
    await ensureDemoRuleSets(prisma); // idempotent
    expect(await prisma.clinicalRuleSet.count()).toBe(4);
  });

  it('a met rule gives the rule outcome, referral recommendation and evidence reference', async () => {
    const s = await screening({ q1: true });
    const { current } = await results('asha1', s.id);
    const diseases = current!.categories.find((c) => c.category === 'DISEASES')!;
    expect(diseases).toMatchObject({
      outcome: 'URGENT_EVALUATION_RECOMMENDED',
      referralRecommended: true,
      suggestedPriority: 'URGENT',
      ruleSet: { code: 'DEMO_RULES_D3', status: 'DRAFT', isDemonstration: true, isOperational: false },
    });
    const observation = await prisma.screeningObservation.findFirstOrThrow({
      where: { sessionId: s.id, questionId: q('DISEASES', 'DEMO_Q1') },
    });
    expect(diseases.rules).toMatchObject([
      { ruleId: 'DEMO_R1', result: 'MET', evidence: [{ kind: 'observation', id: observation.id }] },
    ]);
    expect(diseases.limitations).toEqual(
      expect.arrayContaining([{ code: 'PROTOCOL_NOT_APPROVED' }, { code: 'RULE_SET_NOT_APPROVED' }]),
    );
    // The unfinished developmental category is INCOMPLETE, never "no concern".
    expect(current!.categories.find((c) => c.category === 'DEVELOPMENTAL_DELAYS_DISABILITIES')!.outcome).toBe(
      'INCOMPLETE',
    );
    expect(current!.overallOutcome).toBe('URGENT_EVALUATION_RECOMMENDED');
  });

  it('an UNKNOWN answer is never read as "no": UNABLE_TO_DETERMINE', async () => {
    const s = await screening({ q1: 'UNKNOWN' });
    const diseases = (await results('asha1', s.id)).current!.categories.find(
      (c) => c.category === 'DISEASES',
    )!;
    expect(diseases.outcome).toBe('UNABLE_TO_DETERMINE');
    expect(diseases.limitations).toContainEqual({
      code: 'ANSWER_UNKNOWN',
      question: 'DEMO_Q1',
      ruleId: 'DEMO_R1',
    });
  });

  it('a complete category whose rules are all not met: NO_CONCERN_IN_COMPLETED_ITEMS', async () => {
    const s = await screening({ q1: false });
    const diseases = (await results('asha1', s.id)).current!.categories.find(
      (c) => c.category === 'DISEASES',
    )!;
    expect(diseases.outcome).toBe('NO_CONCERN_IN_COMPLETED_ITEMS');
  });

  it('an amendment creates version 2 with its own result; version 1 is kept, superseded', async () => {
    const s = await screening({ q1: true });
    const v1 = (await results('asha1', s.id)).current!;
    const res = await (
      await as('asha1')
    ).post(`/screenings/${s.id}/amendments`, {
      clientOperationId: randomUUID(),
      expectedSequence: 0,
      reason: 'Synthetic correction of a typing mistake',
      changes: [
        {
          kind: 'RESPONSE',
          category: 'DISEASES',
          questionId: q('DISEASES', 'DEMO_Q1'),
          status: 'ANSWERED',
          source: 'WORKER_OBSERVED',
          value: false,
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { current, history } = await results('asha1', s.id);
    expect(current).toMatchObject({ screeningVersion: 2, isCurrent: true });
    expect(history.map((h) => [h.screeningVersion, h.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    const diseases = current!.categories.find((c) => c.category === 'DISEASES')!;
    expect(diseases.outcome).toBe('NO_CONCERN_IN_COMPLETED_ITEMS');
    expect(diseases.rules[0]!.evidence[0]!.kind).toBe('amendmentChange');
    // The version-1 result is unchanged.
    const old = await prisma.screeningResult.findFirstOrThrow({
      where: { resultRunId: v1.id, category: 'DISEASES' },
    });
    expect(old.outcome).toBe('URGENT_EVALUATION_RECOMMENDED');
    expect(await prisma.clinicalReview.count({ where: { resultRun: { sessionId: s.id } } })).toBe(2);
  });

  it('in production (draft content not allowed) a demonstration rule set is never chosen', async () => {
    const rows = await prisma.clinicalRuleSet.findMany({ where: { code: 'DEMO_RULES_D3' } });
    expect(chooseRuleSet(rows, { allowDraftProtocols: false }, clock.now()).choice).toEqual({ kind: 'NONE' });
    expect(chooseRuleSet(rows, { allowDraftProtocols: true }, clock.now()).choice.kind).toBe('RULE_SET');
  });
});

// ===================================================================== API

describe('results API', () => {
  it('generate-result is idempotent for a completed screening', async () => {
    const s = await screening();
    const res = await (await as('asha1')).post(`/screenings/${s.id}/generate-result`, {});
    expect(res.status).toBe(200);
    expect(res.headers['idempotent-replay']).toBe('true');
    expect(generateResultResponseSchema.parse(res.body).replayed).toBe(true);
    expect(await prisma.screeningResultRun.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it('generate-result backfills a screening completed before Step 7 (explicit, by the caller)', async () => {
    // Completed directly in the database, as before Step 7: no result run exists.
    const s = await screening({ complete: false });
    await prisma.screeningSession.update({
      where: { id: s.id },
      data: { status: 'COMPLETED', completedAt: clock.now(), version: { increment: 1 } },
    });
    expect((await results('asha1', s.id)).current).toBeNull();
    const first = await (await as('mht1')).post(`/screenings/${s.id}/generate-result`, {});
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(generateResultResponseSchema.parse(first.body)).toMatchObject({
      replayed: false,
      result: { screeningVersion: 1, generatedByName: 'Synthetic Medical Officer' },
    });
    const again = await (await as('asha1')).post(`/screenings/${s.id}/generate-result`, {});
    expect(again.status).toBe(200);
    expect(await prisma.screeningResultRun.count({ where: { sessionId: s.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'screening.result_generated', actorUserId: fx.user.mht1! },
    });
    expect(audit.details).toMatchObject({ trigger: 'explicit' });
  });

  it.each([
    ['a draft screening', { complete: false }],
    ['a cancelled screening', { cancel: true }],
  ])('refuses to generate a result for %s (409)', async (_label, options) => {
    const s = await screening(options);
    const res = await (await as('asha1')).post(`/screenings/${s.id}/generate-result`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCREENING_NOT_COMPLETED');
    expect(await prisma.screeningResultRun.count({ where: { sessionId: s.id } })).toBe(0);
  });

  it('another district: 404 and a DENIED audit record (results and generation)', async () => {
    const s = await screening();
    expect((await (await as('asha5')).get(`/screenings/${s.id}/results`)).status).toBe(404);
    expect((await (await as('asha5')).post(`/screenings/${s.id}/generate-result`, {})).status).toBe(404);
    const run = await prisma.screeningResultRun.findFirstOrThrow({ where: { sessionId: s.id } });
    expect((await (await as('asha5')).get(`/screening-results/${run.id}`)).status).toBe(404);
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: fx.user.asha5!, outcome: 'DENIED', entityId: { in: [s.id, run.id] } },
      }),
    ).toBeGreaterThanOrEqual(3);
  });

  it('a supervisor may read results but not generate them (403)', async () => {
    const s = await screening();
    expect((await (await as('sup1')).get(`/screenings/${s.id}/results`)).status).toBe(200);
    expect((await (await as('sup1')).post(`/screenings/${s.id}/generate-result`, {})).status).toBe(403);
  });

  it('rejects unexpected fields (mass assignment) on generate', async () => {
    const s = await screening();
    const res = await (
      await as('asha1')
    ).post(`/screenings/${s.id}/generate-result`, { outcome: 'NO_CONCERN' });
    expect(res.status).toBe(400);
  });

  it('lists only current results in scope, with filters', async () => {
    const s = await screening({ q1: true });
    const mine = resultListResponseSchema.parse(
      (await (await as('asha1')).get('/screening-results?pageSize=50')).body,
    );
    expect(mine.items.some((i) => i.sessionId === s.id)).toBe(true);
    expect(mine.items.every((i) => i.isCurrent)).toBe(true);
    const other = resultListResponseSchema.parse((await (await as('asha5')).get('/screening-results')).body);
    expect(other.items.some((i) => i.sessionId === s.id)).toBe(false);
    const urgent = resultListResponseSchema.parse(
      (await (await as('asha1')).get('/screening-results?outcome=URGENT_EVALUATION_RECOMMENDED&pageSize=50'))
        .body,
    );
    expect(urgent.items.every((i) => i.overallOutcome === 'URGENT_EVALUATION_RECOMMENDED')).toBe(true);
    expect((await (await as('asha1')).get('/screening-results?sort=childName')).status).toBe(400);
  });

  it('rule-set catalogue: reviewers only, read-only', async () => {
    expect((await (await as('asha1')).get('/clinical-rule-sets')).status).toBe(403);
    const list = await (await as('mht1')).get('/clinical-rule-sets');
    expect(list.status).toBe(200);
    const id = (list.body.items as Array<{ id: string; code: string }>).find(
      (r) => r.code === 'DEMO_RULES_D3',
    )!.id;
    const detail = await (await as('mht1')).get(`/clinical-rule-sets/${id}`);
    expect(detail.body.ruleSet).toMatchObject({
      isOperational: false,
      rules: [{ ruleId: 'DEMO_R1', inputs: { questions: ['DEMO_Q1'], measurements: [] } }],
      history: [{ type: 'CREATED', toStatus: 'DRAFT', actorName: 'System (development seed)' }],
    });
    expect((await (await as('mht1')).post('/clinical-rule-sets', {})).status).toBe(404);
  });
});

// ===================================================================== rule-set lifecycle

describe('rule-set lifecycle (CLI path)', () => {
  /** A non-demonstration rule set on the fixture's synthetic (non-demo) SYN protocol. */
  const real = (version: number) =>
    clinicalRuleSetDefinitionSchema.parse({
      dslVersion: 1,
      code: 'SYN_RULES',
      version,
      category: 'DEFICIENCIES',
      protocolCode: 'SYN',
      protocolVersions: [1],
      name: { en: 'Synthetic rules', hi: 'Synthetic rules' },
      ageMinDays: 0,
      ageMaxDays: 3000,
      sourceReference: 'SYNTHETIC TEST - no clinical meaning',
      isDemonstration: false,
      rules: [
        {
          ruleId: 'R1',
          name: { en: 'Synthetic', hi: 'Synthetic' },
          clinicalReference: 'SYNTHETIC TEST',
          when: { answerIs: { question: 'Q1', value: true } },
          outcome: 'FURTHER_EVALUATION_RECOMMENDED',
          referralRecommended: false,
        },
      ],
    });

  it('import -> IN_REVIEW -> APPROVED -> ACTIVE, with history and audit; content frozen', async () => {
    const { id, created } = await importRuleSet(prisma, real(1), 'MHT1');
    expect(created).toBe(true);
    expect((await importRuleSet(prisma, real(1), 'MHT1')).created).toBe(false);
    await changeRuleSetStatus(prisma, {
      code: 'SYN_RULES',
      version: 1,
      to: 'IN_REVIEW',
      actorLoginId: 'MHT1',
    });
    await expect(
      prisma.clinicalRuleSet.update({ where: { id }, data: { sourceReference: 'changed after review' } }),
    ).rejects.toThrow(/frozen/);
    await expect(
      changeRuleSetStatus(prisma, { code: 'SYN_RULES', version: 1, to: 'APPROVED', actorLoginId: 'MHT1' }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REFERENCE_REQUIRED' });
    await expect(
      changeRuleSetStatus(prisma, {
        code: 'SYN_RULES',
        version: 1,
        to: 'APPROVED',
        actorLoginId: 'ASHA1',
        approvalReference: 'SYN-1',
      }),
    ).rejects.toMatchObject({ code: 'APPROVER_NOT_AUTHORISED' });
    await changeRuleSetStatus(prisma, {
      code: 'SYN_RULES',
      version: 1,
      to: 'APPROVED',
      actorLoginId: 'MHT1',
      approvalReference: 'SYN-1',
    });
    await changeRuleSetStatus(prisma, { code: 'SYN_RULES', version: 1, to: 'ACTIVE', actorLoginId: 'MHT1' });
    const row = await prisma.clinicalRuleSet.findUniqueOrThrow({ where: { id }, include: { events: true } });
    expect(row).toMatchObject({ status: 'ACTIVE', approvedById: fx.user.mht1, approvalReference: 'SYN-1' });
    expect(row.events.map((e) => e.toStatus).sort()).toEqual(['ACTIVE', 'APPROVED', 'DRAFT', 'IN_REVIEW']);
    expect(
      await prisma.auditLog.count({ where: { action: 'clinical_rule_set.status_changed', entityId: id } }),
    ).toBe(3);
    await expect(
      prisma.clinicalRuleSetEvent.updateMany({ where: { ruleSetId: id }, data: { reference: 'x' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('a second overlapping ACTIVE set is refused; a different code/version cannot reuse a version', async () => {
    await importRuleSet(prisma, real(2), 'MHT1');
    for (const to of ['IN_REVIEW', 'APPROVED'] as const) {
      await changeRuleSetStatus(prisma, {
        code: 'SYN_RULES',
        version: 2,
        to,
        actorLoginId: 'MHT1',
        approvalReference: 'SYN-2',
      });
    }
    await expect(
      changeRuleSetStatus(prisma, { code: 'SYN_RULES', version: 2, to: 'ACTIVE', actorLoginId: 'MHT1' }),
    ).rejects.toMatchObject({ code: 'ACTIVE_OVERLAP' });
    const changed = { ...real(2), sourceReference: 'different content, same version' };
    await expect(importRuleSet(prisma, changed, 'MHT1')).rejects.toMatchObject({ code: 'VERSION_EXISTS' });
  });

  it('demonstration rules can never be approved (service and database)', async () => {
    await changeRuleSetStatus(prisma, {
      code: 'DEMO_RULES_D1',
      version: 1,
      to: 'IN_REVIEW',
      actorLoginId: 'MHT1',
    });
    await expect(
      changeRuleSetStatus(prisma, {
        code: 'DEMO_RULES_D1',
        version: 1,
        to: 'APPROVED',
        actorLoginId: 'MHT1',
        approvalReference: 'X',
      }),
    ).rejects.toMatchObject({ code: 'DEMONSTRATION_NOT_APPROVABLE' });
    await expect(
      prisma.clinicalRuleSet.update({
        where: { code_version: { code: 'DEMO_RULES_D1', version: 1 } },
        data: {
          status: 'APPROVED',
          approvedById: fx.user.mht1!,
          approvedAt: new Date(),
          approvalReference: 'X',
        },
      }),
    ).rejects.toThrow(/rule_set_approval_complete/);
    await changeRuleSetStatus(prisma, {
      code: 'DEMO_RULES_D1',
      version: 1,
      to: 'DRAFT',
      actorLoginId: 'MHT1',
    });
  });

  it('a real rule set may not be imported without an actor or onto demonstration questions', async () => {
    await expect(importRuleSet(prisma, real(3), null)).rejects.toMatchObject({ code: 'ACTOR_REQUIRED' });
    const onDemo = clinicalRuleSetDefinitionSchema.parse({
      ...real(1),
      code: 'SYN_ON_DEMO',
      category: 'DISEASES',
      protocolCode: 'DEMO_D3',
      rules: [{ ...real(1).rules[0]!, when: { answerIs: { question: 'DEMO_Q1', value: true } } }],
    });
    await expect(importRuleSet(prisma, onDemo, 'MHT1')).rejects.toMatchObject({ code: 'RULE_SET_INVALID' });
  });
});

// ===================================================================== database rules

describe('Step 7 database rules', () => {
  it('results and runs are immutable; a run needs results; results need a completed screening', async () => {
    const s = await screening();
    const run = await prisma.screeningResultRun.findFirstOrThrow({ where: { sessionId: s.id } });
    await expect(
      prisma.screeningResult.updateMany({
        where: { resultRunId: run.id },
        data: { outcome: 'NO_CONCERN_IN_COMPLETED_ITEMS' },
      }),
    ).rejects.toThrow(/insert-only/);
    await expect(
      prisma.screeningResultRun.update({
        where: { id: run.id },
        data: { overallOutcome: 'NO_CONCERN_IN_COMPLETED_ITEMS' },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.screeningResultRun.delete({ where: { id: run.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    // A second run for the same version.
    await expect(
      prisma.screeningResultRun.create({
        data: {
          sessionId: s.id,
          screeningVersion: 1,
          overallOutcome: 'NOT_INTERPRETED',
          usesUnapprovedContent: true,
          engineVersion: 'x',
          generatedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    const open = await screening({ complete: false });
    await expect(
      prisma.$transaction(async (tx) => {
        const r = await tx.screeningResultRun.create({
          data: {
            sessionId: open.id,
            screeningVersion: 1,
            overallOutcome: 'NOT_INTERPRETED',
            usesUnapprovedContent: true,
            engineVersion: 'x',
            generatedAt: new Date(),
          },
        });
        await tx.screeningResult.create({
          data: {
            resultRunId: r.id,
            sessionId: open.id,
            category: 'DEFECTS_AT_BIRTH',
            outcome: 'NOT_ASSESSED',
            source: 'RULE_ENGINE',
            evidence: [],
            limitations: [],
          },
        });
      }),
    ).rejects.toThrow(/COMPLETED/);
  });

  it('a concern outcome or referral recommendation needs a rule set', async () => {
    const s = await screening();
    const run = await prisma.screeningResultRun.findFirstOrThrow({ where: { sessionId: s.id } });
    await expect(
      prisma.screeningResult.create({
        data: {
          resultRunId: run.id,
          sessionId: s.id,
          category: 'DEFECTS_AT_BIRTH',
          outcome: 'URGENT_EVALUATION_RECOMMENDED',
          source: 'RULE_ENGINE',
          evidence: [],
          limitations: [],
        },
      }),
    ).rejects.toThrow(/result_rule_set_matches_outcome|result_not_assessed_has_no_category/);
  });

  it('facilities: no claims without verification, no deletes, versioned', async () => {
    const base = { type: 'PHC' as const, areaId: fx.area.D1!, createdById: fx.user.stateadmin! };
    await expect(
      prisma.facility.create({ data: { ...base, name: 'Synthetic Unverified', acceptsReferrals: true } }),
    ).rejects.toThrow(/facility_claims_need_verification/);
    await expect(
      prisma.facility.create({ data: { ...base, name: 'Synthetic Services', services: ['ANY'] } }),
    ).rejects.toThrow(/facility_claims_need_verification/);
    const f = await prisma.facility.create({
      data: { ...base, name: 'Synthetic Directory PHC', officialCode: 'SYN-1' },
    });
    await expect(
      prisma.facility.create({ data: { ...base, name: 'synthetic directory phc' } }),
    ).rejects.toThrow();
    await expect(
      prisma.facility.create({ data: { ...base, name: 'Other', officialCode: 'SYN-1' } }),
    ).rejects.toThrow();
    await expect(prisma.facility.update({ where: { id: f.id }, data: { name: 'Renamed' } })).rejects.toThrow(
      /write conflict/,
    );
    await expect(prisma.facility.delete({ where: { id: f.id } })).rejects.toThrow(/cannot be deleted/);
  });

  describe('referrals', () => {
    async function referral(sessionId: string | null, childId: string, extra: object = {}) {
      return prisma.$transaction(async (tx) => {
        const r = await tx.referral.create({
          data: {
            childId,
            sessionId,
            origin: 'WORKER_CONCERN',
            reasonCode: 'SYNTHETIC',
            areaId: fx.area.V1!,
            category: 'DISEASES',
            urgency: 'ROUTINE',
            createdById: fx.user.asha1!,
            ...extra,
          },
        });
        await tx.referralStatusEvent.create({
          data: {
            referralId: r.id,
            toStatus: r.status,
            changedById: fx.user.asha1!,
            actorRoleCode: 'ASHA',
            source: 'APP_USER_DIRECT',
            verificationStatus: 'VERIFIED',
          },
        });
        return r;
      });
    }

    it('needs its first status event; one active referral per screening and category', async () => {
      const s = await screening();
      await expect(
        prisma.referral.create({
          data: {
            childId: s.childId,
            origin: 'WORKER_CONCERN',
            reasonCode: 'SYNTHETIC',
            areaId: fx.area.V1!,
            urgency: 'ROUTINE',
            createdById: fx.user.asha1!,
          },
        }),
      ).rejects.toThrow(/first status event/);
      await referral(s.id, s.childId);
      await expect(referral(s.id, s.childId)).rejects.toThrow(/referral_one_active_per_category|Unique/);
    });

    it("only a clinical-review referral starts approved; the screening must be the same child's", async () => {
      const s = await screening();
      const other = await screening();
      await expect(referral(s.id, s.childId, { status: 'APPROVED' })).rejects.toThrow(/PENDING_APPROVAL/);
      await expect(referral(other.id, s.childId)).rejects.toThrow(/same child/);
    });

    it('follows the state machine; every change needs its event; final states are final', async () => {
      const s = await screening();
      const r = await referral(s.id, s.childId);
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.referralStatusEvent.create({
            data: {
              referralId: r.id,
              fromStatus: 'PENDING_APPROVAL',
              toStatus: 'VISITED',
              changedById: fx.user.mht1!,
              actorRoleCode: 'MHT_MEDICAL_OFFICER',
              source: 'APP_USER_DIRECT',
              verificationStatus: 'VERIFIED',
            },
          });
          await tx.referral.update({
            where: { id: r.id },
            data: { status: 'VISITED', version: { increment: 1 } },
          });
        }),
      ).rejects.toThrow(/cannot change from PENDING_APPROVAL to VISITED/);
      // A valid move without its event is refused at commit.
      await expect(
        prisma.referral.update({
          where: { id: r.id },
          data: {
            status: 'APPROVED',
            approvedById: fx.user.mht1!,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
        }),
      ).rejects.toThrow(/needs its status event/);
      // Cancellation needs a reason.
      await expect(
        prisma.referralStatusEvent.create({
          data: {
            referralId: r.id,
            fromStatus: 'PENDING_APPROVAL',
            toStatus: 'CANCELLED',
            changedById: fx.user.asha1!,
            actorRoleCode: 'ASHA',
            source: 'APP_USER_DIRECT',
            verificationStatus: 'VERIFIED',
          },
        }),
      ).rejects.toThrow(/referral_event_reason_required/);
      // Issuing without facility and consent is refused.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.referralStatusEvent.create({
            data: {
              referralId: r.id,
              fromStatus: 'PENDING_APPROVAL',
              toStatus: 'APPROVED',
              changedById: fx.user.mht1!,
              actorRoleCode: 'MHT_MEDICAL_OFFICER',
              source: 'APP_USER_DIRECT',
              verificationStatus: 'VERIFIED',
            },
          });
          await tx.referral.update({
            where: { id: r.id },
            data: {
              status: 'APPROVED',
              approvedById: fx.user.mht1!,
              approvedAt: new Date(),
              version: { increment: 1 },
            },
          });
          await tx.referralStatusEvent.create({
            data: {
              referralId: r.id,
              fromStatus: 'APPROVED',
              toStatus: 'ISSUED',
              changedById: fx.user.asha1!,
              actorRoleCode: 'ASHA',
              source: 'APP_USER_DIRECT',
              verificationStatus: 'VERIFIED',
            },
          });
          await tx.referral.update({
            where: { id: r.id },
            data: { status: 'ISSUED', issuedAt: new Date(), version: { increment: 1 } },
          });
        }),
      ).rejects.toThrow(/referral_issue_complete/);
      await expect(prisma.referral.delete({ where: { id: r.id } })).rejects.toThrow(/cannot be deleted/);
      await expect(
        prisma.referralStatusEvent.updateMany({ where: { referralId: r.id }, data: { note: 'x' } }),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('follow-ups: one active task per child + referral + reason; assignee rules; history append-only', async () => {
    const s = await screening();
    const base = {
      childId: s.childId,
      reasonCode: 'SYNTHETIC',
      dueDate: new Date('2027-01-01'),
      createdById: fx.user.asha1!,
    };
    const f = await prisma.followUp.create({ data: base });
    await expect(prisma.followUp.create({ data: base })).rejects.toThrow(
      /follow_up_one_active_per_reason|Unique/,
    );
    await expect(
      prisma.followUp.update({
        where: { id: f.id },
        data: { status: 'ASSIGNED', version: { increment: 1 } },
      }),
    ).rejects.toThrow(/follow_up_assignee/);
    await expect(
      prisma.followUp.update({
        where: { id: f.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedById: fx.user.asha1!,
          version: { increment: 1 },
        },
      }),
    ).rejects.toThrow(/cannot change from PENDING to COMPLETED/);
    await expect(
      prisma.followUpEvent.create({
        data: { followUpId: f.id, type: 'RESCHEDULED', toStatus: 'PENDING', actorId: fx.user.asha1! },
      }),
    ).rejects.toThrow(/follow_up_event_reason_required/);
  });

  it('clinical reviews: start pending; decisions need notes (except accept); version guards concurrency', async () => {
    const s = await screening();
    const review = await prisma.clinicalReview.findFirstOrThrow({
      where: { resultRun: { sessionId: s.id } },
    });
    await prisma.clinicalReview.update({
      where: { id: review.id },
      data: {
        status: 'UNDER_REVIEW',
        claimedById: fx.user.mht1!,
        claimedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await expect(
      prisma.clinicalReview.update({
        where: { id: review.id },
        data: {
          status: 'REJECTED',
          decision: 'REJECT_WITH_REASON',
          decidedById: fx.user.mht1!,
          decidedAt: new Date(),
          decidedByRoleCode: 'MHT_MEDICAL_OFFICER',
          version: { increment: 1 },
        },
      }),
    ).rejects.toThrow(/review_decided_complete/);
    await expect(
      prisma.clinicalReview.update({
        where: { id: review.id },
        data: { status: 'PENDING_REVIEW', claimedById: null, claimedAt: null },
      }),
    ).rejects.toThrow(/write conflict/);
  });

  it('notifications: only a one-time read mark may change', async () => {
    const n = await prisma.notification.create({
      data: {
        userId: fx.user.asha1!,
        type: 'SYSTEM',
        entityType: 'synthetic',
        entityId: randomUUID(),
        dedupeKey: `SYN:${randomUUID()}`,
        payload: {},
      },
    });
    await expect(
      prisma.notification.update({ where: { id: n.id }, data: { payload: { x: 1 } } }),
    ).rejects.toThrow(/immutable/);
    await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    await expect(
      prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } }),
    ).rejects.toThrow(/immutable/);
  });
});
