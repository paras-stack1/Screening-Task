import { randomUUID } from 'node:crypto';
import {
  childDetailResponseSchema,
  protocolDefinitionSchema,
  screeningEligibilityResponseSchema,
  screeningProtocolDetailResponseSchema,
  screeningProtocolListResponseSchema,
  type ProtocolDefinition,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { ensureConsentTemplates } from '../../src/modules/consent/consentNotices';
import { DEMO_PROTOCOLS, ensureDemoProtocols } from '../../src/modules/screening/demoProtocols';
import { definitionToCreateInput, protocolContentHash } from '../../src/modules/screening/protocolContent';
import { changeProtocolStatus } from '../../src/modules/screening/protocolLifecycle';
import { testAuthConfig } from './authFixture';
import {
  api,
  buildAuthzFixture,
  createTestApp,
  PASSWORD,
  TestClock,
  tokenFor,
  type AuthzFixture,
} from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 6, stage 6B: screening foundation - database integrity rules (migration
 * 20261122120000_step6_screening_foundation), the governed protocol lifecycle, the read-only
 * protocol API and per-child eligibility. Synthetic data only. Tests connect as the database
 * owner, so every trigger rule shown here applies to every account, not just the API.
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createTestApp>;
let prodApp: ReturnType<typeof createTestApp>;
const tokens = new Map<string, string>();
let screeningTemplateId: string;
let mhtLogin: string;

async function as(login: string, target = app) {
  const key = `${login}:${target === app ? 'dev' : 'prod'}`;
  if (!tokens.has(key)) tokens.set(key, await tokenFor(target, login));
  return api(target, tokens.get(key)!);
}

// ------------------------------------------------------------------------ helpers

let seq = 0;
function definition(overrides: Partial<ProtocolDefinition> = {}): ProtocolDefinition {
  seq += 1;
  return protocolDefinitionSchema.parse({
    code: `TEST_P${seq}`,
    version: 1,
    category: 'DISEASES',
    name: { hi: `परीक्षण ${seq}`, en: `Test ${seq}` },
    ageMinDays: 0,
    ageMaxDays: 2000,
    sourceReference: 'synthetic test protocol',
    isDemonstration: false,
    questions: [
      {
        code: 'Q1',
        sectionCode: 'S1',
        sortOrder: 10,
        prompt: { hi: 'प्रश्न 1', en: 'Question 1' },
        answerType: 'YES_NO',
        isRequired: true,
      },
      {
        code: 'Q2',
        sectionCode: 'S1',
        sortOrder: 20,
        prompt: { hi: 'प्रश्न 2', en: 'Question 2' },
        answerType: 'TEXT',
        isRequired: false,
      },
    ],
    ...overrides,
  });
}

async function createProtocol(overrides: Partial<ProtocolDefinition> = {}) {
  const def = definition(overrides);
  const row = await prisma.screeningProtocol.create({
    data: definitionToCreateInput(def),
    include: { questions: true },
  });
  return { def, row, q: Object.fromEntries(row.questions.map((x) => [x.code, x.id])) };
}

/** A V1 child (direct insert) with a mother holding a GRANTED SCREENING consent. */
async function childWithConsent(dateOfBirth = '2024-06-01') {
  seq += 1;
  const child = await prisma.child.create({
    data: {
      areaId: fx.area.V1!,
      fullName: `Synthetic Screening Child ${seq}`,
      dateOfBirth: new Date(dateOfBirth),
      sexAtBirth: 'FEMALE',
      createdById: fx.user.asha1!,
    },
  });
  const guardian = await prisma.guardian.create({ data: { fullName: 'Synthetic Mother' } });
  await prisma.childGuardian.create({
    data: { childId: child.id, guardianId: guardian.id, relationship: 'MOTHER', canGiveConsent: true },
  });
  const consent = await prisma.consent.create({
    data: {
      childId: child.id,
      guardianId: guardian.id,
      purpose: 'SCREENING',
      decision: 'GRANTED',
      method: 'SIGNATURE',
      templateId: screeningTemplateId,
      recordedById: fx.user.asha1!,
      recordedAt: clock.now(),
    },
  });
  return { childId: child.id, guardianId: guardian.id, consentId: consent.id };
}

async function newSession(childId: string, consentId: string, ageInDaysAtStart = 900) {
  return prisma.screeningSession.create({
    data: {
      childId,
      conductedById: fx.user.asha1!,
      areaId: fx.area.V1!,
      ageInDaysAtStart,
      dateOfBirthAtStart: new Date('2024-06-01'),
      dobEstimatedAtStart: false,
      screeningConsentId: consentId,
      startedAt: clock.now(),
    },
  });
}

async function startCategory(sessionId: string, protocolId: string, category = 'DISEASES' as const) {
  const protocol = await prisma.screeningProtocol.findUniqueOrThrow({ where: { id: protocolId } });
  return prisma.screeningSessionCategory.create({
    data: {
      sessionId,
      category,
      protocolId,
      protocolStatusAtStart: protocol.status,
      startedAt: clock.now(),
    },
  });
}

function answer(sessionId: string, sessionCategoryId: string, questionId: string, value = true) {
  return prisma.screeningObservation.create({
    data: {
      sessionId,
      sessionCategoryId,
      questionId,
      status: 'ANSWERED',
      source: 'WORKER_OBSERVED',
      valueBoolean: value,
      recordedById: fx.user.asha1!,
      recordedAt: clock.now(),
    },
  });
}

function measure(childId: string, sessionId: string | null, extra: object = {}) {
  return prisma.measurement.create({
    data: {
      childId,
      sessionId,
      type: 'WEIGHT',
      value: 10.5,
      unit: 'kg',
      source: 'MEASURED',
      quality: 'RELIABLE',
      measuredAt: clock.now(),
      recordedById: fx.user.asha1!,
      ...extra,
    },
  });
}

const bump = { version: { increment: 1 } };

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  app = createTestApp(prisma, clock);
  prodApp = createApp({
    auth: {
      db: prisma,
      config: testAuthConfig,
      now: clock.now,
      rateLimits: { ...DEFAULT_RATE_LIMITS, loginPerIpAndAccount: 1000, loginPerIp: 1000 },
    },
    screeningPolicy: { allowDraftProtocols: false },
    consentPolicy: { allowDraftNotices: true },
  });
  fx = await buildAuthzFixture(prisma, clock);
  expect(await ensureConsentTemplates(prisma)).toEqual([]);
  screeningTemplateId = (
    await prisma.consentTemplate.findFirstOrThrow({ where: { purpose: 'SCREENING', version: 0 } })
  ).id;

  // A clinical reviewer (RBSK MHT medical officer) in V1, for approvals.
  const mht = await prisma.user.findUniqueOrThrow({ where: { id: fx.user.asha1! } });
  mhtLogin = 'mht1';
  const reviewer = await prisma.user.create({
    data: {
      loginId: mhtLogin.toUpperCase(),
      passwordHash: mht.passwordHash,
      displayName: 'Synthetic Medical Officer',
      mustChangePassword: false,
    },
  });
  await prisma.workerAreaAssignment.create({
    data: {
      userId: reviewer.id,
      areaId: fx.area.V1!,
      roleId: fx.role.MHT_MEDICAL_OFFICER!,
      scope: 'AREA_ONLY',
      effectiveFrom: new Date(clock.now().getTime() - 1000),
      createdById: fx.user.stateadmin!,
    },
  });
  expect(PASSWORD).toBeTruthy();
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

// ======================================================= protocol content governance

describe('protocol content governance (database)', () => {
  it('lets an unused DRAFT be edited, and freezes content and questions once in review', async () => {
    const { row } = await createProtocol();
    await prisma.screeningProtocol.update({ where: { id: row.id }, data: { nameEn: 'Renamed draft' } });
    await changeProtocolStatus(prisma, {
      code: row.code,
      version: 1,
      to: 'IN_REVIEW',
      actorLoginId: 'asha1',
    });

    await expect(
      prisma.screeningProtocol.update({ where: { id: row.id }, data: { nameEn: 'Sneaky edit' } }),
    ).rejects.toThrow(/content is frozen/);
    await expect(
      prisma.screeningProtocol.update({ where: { id: row.id }, data: { ageMaxDays: 9999 } }),
    ).rejects.toThrow(/content is frozen/);
    await expect(
      prisma.screeningQuestion.updateMany({ where: { protocolId: row.id }, data: { isRequired: false } }),
    ).rejects.toThrow(/frozen/);
    await expect(
      prisma.screeningQuestion.create({
        data: {
          protocolId: row.id,
          code: 'Q9',
          category: 'DISEASES',
          sectionCode: 'S1',
          sortOrder: 90,
          promptKey: 'x',
          prompt: { hi: 'x', en: 'x' },
          answerType: 'YES_NO',
        },
      }),
    ).rejects.toThrow(/frozen/);
    await expect(prisma.screeningQuestion.deleteMany({ where: { protocolId: row.id } })).rejects.toThrow(
      /frozen/,
    );
    await expect(prisma.screeningProtocol.delete({ where: { id: row.id } })).rejects.toThrow(
      /Only DRAFT screening protocols can be deleted/,
    );
  });

  it('freezes a DRAFT protocol as soon as any session has used it', async () => {
    const { row, q } = await createProtocol();
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    await startCategory(s.id, row.id);
    await expect(
      prisma.screeningProtocol.update({ where: { id: row.id }, data: { nameEn: 'Changed after use' } }),
    ).rejects.toThrow(/content is frozen/);
    await expect(
      prisma.screeningQuestion.update({
        where: { id: q.Q1! },
        data: { prompt: { hi: 'बदला', en: 'Changed' } },
      }),
    ).rejects.toThrow(/frozen/);
  });

  it('rejects a question whose category differs from its protocol', async () => {
    const { row } = await createProtocol();
    await expect(
      prisma.screeningQuestion.create({
        data: {
          protocolId: row.id,
          code: 'QX',
          category: 'DEFICIENCIES',
          sectionCode: 'S1',
          sortOrder: 5,
          promptKey: 'x',
          prompt: { hi: 'x', en: 'x' },
          answerType: 'YES_NO',
        },
      }),
    ).rejects.toThrow(/must match its protocol category/);
  });

  it('enforces the lifecycle order even for direct database updates', async () => {
    const { row } = await createProtocol();
    await expect(
      prisma.screeningProtocol.update({
        where: { id: row.id },
        data: { status: 'ACTIVE', effectiveFrom: clock.now() },
      }),
    ).rejects.toThrow(/cannot change from DRAFT to ACTIVE/);
    // APPROVED needs approver, time, reference and content hash (CHECK), whatever the path.
    await prisma.screeningProtocol.update({
      where: { id: row.id },
      data: { status: 'IN_REVIEW', contentSha256: protocolContentHash(definition()) },
    });
    await expect(
      prisma.screeningProtocol.update({ where: { id: row.id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow(/protocol_approval_complete/);
  });

  it('refuses to submit a protocol without questions for review', async () => {
    const empty = await prisma.screeningProtocol.create({
      data: {
        code: 'EMPTY_P',
        version: 1,
        category: 'DISEASES',
        nameEn: 'Empty',
        nameHi: 'खाली',
        ageMinDays: 0,
        ageMaxDays: 10,
        sourceReference: 'synthetic',
      },
    });
    await expect(
      prisma.screeningProtocol.update({
        where: { id: empty.id },
        data: { status: 'IN_REVIEW', contentSha256: 'x' },
      }),
    ).rejects.toThrow(/without questions/);
  });
});

describe('protocol lifecycle (admin process, decision E)', () => {
  it('reviews, approves, activates and retires with an audit trail; approval is immutable', async () => {
    const { row, def } = await createProtocol({
      category: 'DEFECTS_AT_BIRTH',
      ageMinDays: 0,
      ageMaxDays: 30,
    });
    const review = await changeProtocolStatus(prisma, {
      code: def.code,
      version: 1,
      to: 'IN_REVIEW',
      actorLoginId: 'asha1',
    });
    expect(review.contentSha256).toBe(protocolContentHash(def));

    await expect(
      changeProtocolStatus(prisma, {
        code: def.code,
        version: 1,
        to: 'APPROVED',
        actorLoginId: 'asha1',
        approvalReference: 'CMTE-1',
      }),
    ).rejects.toMatchObject({ code: 'APPROVER_NOT_AUTHORISED' });
    await expect(
      changeProtocolStatus(prisma, { code: def.code, version: 1, to: 'APPROVED', actorLoginId: mhtLogin }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REFERENCE_REQUIRED' });

    await changeProtocolStatus(prisma, {
      code: def.code,
      version: 1,
      to: 'APPROVED',
      actorLoginId: mhtLogin,
      approvalReference: 'SYNTHETIC-CMTE-2026-01',
    });
    await changeProtocolStatus(
      prisma,
      { code: def.code, version: 1, to: 'ACTIVE', actorLoginId: mhtLogin },
      clock.now(),
    );

    const active = await prisma.screeningProtocol.findUniqueOrThrow({ where: { id: row.id } });
    expect(active).toMatchObject({ status: 'ACTIVE', approvalReference: 'SYNTHETIC-CMTE-2026-01' });
    expect(active.clinicalApprovedById).not.toBeNull();
    await expect(
      prisma.screeningProtocol.update({ where: { id: row.id }, data: { approvalReference: 'rewritten' } }),
    ).rejects.toThrow(/approval record is immutable/);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: row.id, action: 'screening_protocol.status_changed' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audit.map((a) => (a.details as { to: string }).to)).toEqual(['IN_REVIEW', 'APPROVED', 'ACTIVE']);

    await changeProtocolStatus(prisma, { code: def.code, version: 1, to: 'RETIRED', actorLoginId: mhtLogin });
    await expect(
      changeProtocolStatus(prisma, { code: def.code, version: 1, to: 'ACTIVE', actorLoginId: mhtLogin }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('sending back to DRAFT clears the reviewed hash and allows rework', async () => {
    const { row, def } = await createProtocol();
    await changeProtocolStatus(prisma, {
      code: def.code,
      version: 1,
      to: 'IN_REVIEW',
      actorLoginId: 'asha1',
    });
    await changeProtocolStatus(prisma, { code: def.code, version: 1, to: 'DRAFT', actorLoginId: 'asha1' });
    const back = await prisma.screeningProtocol.update({
      where: { id: row.id },
      data: { nameEn: 'Reworked' },
    });
    expect(back.contentSha256).toBeNull();
  });

  it('never approves demonstration content (application and database)', async () => {
    const { row, def } = await createProtocol({ isDemonstration: true });
    await changeProtocolStatus(prisma, {
      code: def.code,
      version: 1,
      to: 'IN_REVIEW',
      actorLoginId: 'asha1',
    });
    await expect(
      changeProtocolStatus(prisma, {
        code: def.code,
        version: 1,
        to: 'APPROVED',
        actorLoginId: mhtLogin,
        approvalReference: 'X',
      }),
    ).rejects.toMatchObject({ code: 'DEMONSTRATION_NOT_APPROVABLE' });
    await expect(
      prisma.screeningProtocol.update({
        where: { id: row.id },
        data: {
          status: 'APPROVED',
          clinicalApprovedById: fx.user.asha1!,
          clinicalApprovedAt: clock.now(),
          approvalReference: 'X',
        },
      }),
    ).rejects.toThrow(/protocol_approval_complete/);
  });

  it('refuses two ACTIVE protocols of one category with overlapping age bands', async () => {
    const approveAndActivate = async (def: ProtocolDefinition) => {
      for (const to of ['IN_REVIEW', 'APPROVED', 'ACTIVE'] as const) {
        await changeProtocolStatus(
          prisma,
          {
            code: def.code,
            version: 1,
            to,
            actorLoginId: mhtLogin,
            approvalReference: 'SYNTHETIC-REF',
          },
          clock.now(),
        );
      }
    };
    const a = await createProtocol({
      category: 'DEVELOPMENTAL_DELAYS_DISABILITIES',
      ageMinDays: 100,
      ageMaxDays: 200,
    });
    const b = await createProtocol({
      category: 'DEVELOPMENTAL_DELAYS_DISABILITIES',
      ageMinDays: 200,
      ageMaxDays: 300,
    });
    const c = await createProtocol({
      category: 'DEVELOPMENTAL_DELAYS_DISABILITIES',
      ageMinDays: 201,
      ageMaxDays: 300,
    });
    const other = await createProtocol({ category: 'DISEASES', ageMinDays: 100, ageMaxDays: 200 });
    await approveAndActivate(a.def);
    await expect(approveAndActivate(b.def)).rejects.toMatchObject({ code: 'ACTIVE_OVERLAP' }); // day 200 shared
    await approveAndActivate(c.def); // adjacent band: fine
    await approveAndActivate(other.def); // other category: fine
  });
});

// ===================================================== session and record integrity

describe('screening session integrity (database)', () => {
  it('requires a granted, not withdrawn SCREENING consent of the same child', async () => {
    const c1 = await childWithConsent();
    const c2 = await childWithConsent();
    await expect(newSession(c1.childId, c2.consentId)).rejects.toThrow(/SCREENING consent of the same child/);

    const photoTemplate = await prisma.consentTemplate.findFirstOrThrow({
      where: { purpose: 'PHOTO_CAPTURE' },
    });
    const photo = await prisma.consent.create({
      data: {
        childId: c1.childId,
        guardianId: c1.guardianId,
        purpose: 'PHOTO_CAPTURE',
        decision: 'GRANTED',
        method: 'SIGNATURE',
        templateId: photoTemplate.id,
        recordedById: fx.user.asha1!,
        recordedAt: clock.now(),
      },
    });
    await expect(newSession(c1.childId, photo.id)).rejects.toThrow(/SCREENING consent/);

    await prisma.consent.update({
      where: { id: c1.consentId },
      data: { withdrawnAt: clock.now(), withdrawnById: fx.user.asha1!, withdrawalMethod: 'SIGNATURE' },
    });
    await expect(newSession(c1.childId, c1.consentId)).rejects.toThrow(/not withdrawn/);
  });

  it('allows only one open session per child and no session deletion', async () => {
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    await expect(newSession(c.childId, c.consentId)).rejects.toThrow(/Unique constraint failed/);
    await expect(prisma.screeningSession.delete({ where: { id: s.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it('requires the version to increase by exactly one (optimistic locking)', async () => {
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    // Raised as serialization_failure (40001): Prisma reports it as a write conflict (P2034).
    await expect(
      prisma.screeningSession.update({ where: { id: s.id }, data: { status: 'IN_PROGRESS' } }),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect((await prisma.screeningSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('DRAFT');
    await prisma.screeningSession.update({ where: { id: s.id }, data: { status: 'IN_PROGRESS', ...bump } });
    await expect(
      prisma.screeningSession.update({ where: { id: s.id }, data: { ageInDaysAtStart: 1, ...bump } }),
    ).rejects.toThrow(/immutable/);
  });

  it('completes only with a completed category, and only from IN_PROGRESS', async () => {
    const { row, q } = await createProtocol();
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    await expect(
      prisma.screeningSession.update({
        where: { id: s.id },
        data: { status: 'COMPLETED', completedAt: clock.now(), ...bump },
      }),
    ).rejects.toThrow(/cannot change from DRAFT to COMPLETED/);
    await prisma.screeningSession.update({ where: { id: s.id }, data: { status: 'IN_PROGRESS', ...bump } });
    const cat = await startCategory(s.id, row.id);
    await expect(
      prisma.screeningSession.update({
        where: { id: s.id },
        data: { status: 'COMPLETED', completedAt: clock.now(), ...bump },
      }),
    ).rejects.toThrow(/at least one completed category/);

    // A category completes only when every REQUIRED question has an explicit state.
    await expect(
      prisma.screeningSessionCategory.update({
        where: { id: cat.id },
        data: { status: 'COMPLETED', completedAt: clock.now() },
      }),
    ).rejects.toThrow(/Every required question/);
    await answer(s.id, cat.id, q.Q1!);
    await prisma.screeningSessionCategory.update({
      where: { id: cat.id },
      data: { status: 'COMPLETED', completedAt: clock.now() },
    });
    await prisma.screeningSession.update({
      where: { id: s.id },
      data: { status: 'COMPLETED', completedAt: clock.now(), ...bump },
    });
  });

  it('makes a completed session and everything in it final', async () => {
    const { row, q } = await createProtocol();
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    await prisma.screeningSession.update({ where: { id: s.id }, data: { status: 'IN_PROGRESS', ...bump } });
    const cat = await startCategory(s.id, row.id);
    const obs = await answer(s.id, cat.id, q.Q1!);
    const m = await measure(c.childId, s.id);
    await prisma.screeningSessionCategory.update({
      where: { id: cat.id },
      data: { status: 'COMPLETED', completedAt: clock.now() },
    });
    await prisma.screeningSession.update({
      where: { id: s.id },
      data: { status: 'COMPLETED', completedAt: clock.now(), ...bump },
    });

    await expect(
      prisma.screeningSession.update({ where: { id: s.id }, data: { status: 'CANCELLED', ...bump } }),
    ).rejects.toThrow(/COMPLETED and can no longer be changed/);
    await expect(
      prisma.screeningSessionCategory.update({ where: { id: cat.id }, data: { notes: 'late note' } }),
    ).rejects.toThrow(/can no longer be changed/);
    await expect(
      prisma.screeningObservation.update({ where: { id: obs.id }, data: { valueBoolean: false } }),
    ).rejects.toThrow(/can no longer be changed/);
    await expect(prisma.screeningObservation.delete({ where: { id: obs.id } })).rejects.toThrow(
      /can no longer be changed/,
    );
    await expect(answer(s.id, cat.id, q.Q2!)).rejects.toThrow(/can no longer be changed/);
    await expect(measure(c.childId, s.id)).rejects.toThrow(/can no longer be changed/);
    await expect(
      measure(c.childId, s.id, { supersedesId: m.id, correctionReason: 'late fix' }),
    ).rejects.toThrow(/can no longer be changed/);
  });

  it('records cancellation completely (who, when, why) and then freezes the session', async () => {
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    await expect(
      prisma.screeningSession.update({
        where: { id: s.id },
        data: { status: 'CANCELLED', cancelledAt: clock.now(), ...bump },
      }),
    ).rejects.toThrow(/session_cancellation_complete/);
    await prisma.screeningSession.update({
      where: { id: s.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: clock.now(),
        cancelledById: fx.user.asha1!,
        cancelReason: 'Child not available',
        ...bump,
      },
    });
    // A new session may now be opened for the child.
    await newSession(c.childId, c.consentId);
  });
});

describe('category and answer integrity (database)', () => {
  it('only accepts a usable protocol of the right category that covers the child age', async () => {
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId, 900);
    const diseases = await createProtocol({ category: 'DISEASES' });
    await expect(startCategory(s.id, diseases.row.id, 'DEFICIENCIES' as 'DISEASES')).rejects.toThrow(
      /does not match/,
    );
    const young = await createProtocol({ ageMinDays: 0, ageMaxDays: 100 });
    await expect(startCategory(s.id, young.row.id)).rejects.toThrow(/does not cover the child's age/);

    const inReview = await createProtocol();
    await changeProtocolStatus(prisma, {
      code: inReview.def.code,
      version: 1,
      to: 'IN_REVIEW',
      actorLoginId: 'asha1',
    });
    await expect(startCategory(s.id, inReview.row.id)).rejects.toThrow(/not usable \(status IN_REVIEW\)/);

    // The recorded status must be the protocol's real status.
    await expect(
      prisma.screeningSessionCategory.create({
        data: {
          sessionId: s.id,
          category: 'DISEASES',
          protocolId: diseases.row.id,
          protocolStatusAtStart: 'ACTIVE',
          startedAt: clock.now(),
        },
      }),
    ).rejects.toThrow(/not usable/);

    await startCategory(s.id, diseases.row.id);
    await expect(startCategory(s.id, diseases.row.id)).rejects.toThrow(
      /sessionId_category|Unique constraint/,
    );
  });

  it('rejects answers to a question of another protocol version or another session', async () => {
    const p1 = await createProtocol();
    const p2 = await createProtocol();
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    const cat = await startCategory(s.id, p1.row.id);
    await expect(answer(s.id, cat.id, p2.q.Q1!)).rejects.toThrow(/does not belong to the protocol version/);

    const c2 = await childWithConsent();
    const s2 = await newSession(c2.childId, c2.consentId);
    await expect(answer(s2.id, cat.id, p1.q.Q1!)).rejects.toThrow(/belongs to another session/);
  });

  it('keeps answer state and value consistent: missing data is never a value', async () => {
    const { row, q } = await createProtocol();
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    const cat = await startCategory(s.id, row.id);
    const base = {
      sessionId: s.id,
      sessionCategoryId: cat.id,
      questionId: q.Q1!,
      source: 'WORKER_OBSERVED' as const,
      recordedById: fx.user.asha1!,
      recordedAt: clock.now(),
    };
    await expect(
      prisma.screeningObservation.create({ data: { ...base, status: 'ANSWERED' } }),
    ).rejects.toThrow(/observation_value_matches_status/);
    for (const status of ['UNKNOWN', 'NOT_ASSESSED', 'UNABLE_TO_ASSESS'] as const) {
      await expect(
        prisma.screeningObservation.create({ data: { ...base, status, valueBoolean: false } }),
      ).rejects.toThrow(/observation_value_matches_status/);
    }
    await expect(
      prisma.screeningObservation.create({ data: { ...base, status: 'UNKNOWN', notAssessedReason: 'x' } }),
    ).rejects.toThrow(/observation_reason_only_when_not_assessed/);
    const unknown = await prisma.screeningObservation.create({ data: { ...base, status: 'UNKNOWN' } });
    expect(unknown.valueBoolean).toBeNull();
  });

  it('freezes answers of a completed category until it is reopened', async () => {
    const { row, q } = await createProtocol();
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    const cat = await startCategory(s.id, row.id);
    const obs = await answer(s.id, cat.id, q.Q1!);
    await prisma.screeningSessionCategory.update({
      where: { id: cat.id },
      data: { status: 'COMPLETED', completedAt: clock.now() },
    });
    await expect(
      prisma.screeningObservation.update({ where: { id: obs.id }, data: { valueBoolean: false } }),
    ).rejects.toThrow(/reopen the category first/);
    await prisma.screeningSessionCategory.update({
      where: { id: cat.id },
      data: { status: 'IN_PROGRESS', completedAt: null },
    });
    await prisma.screeningObservation.update({ where: { id: obs.id }, data: { valueBoolean: false } });
    await expect(prisma.screeningSessionCategory.delete({ where: { id: cat.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });
});

describe('measurement integrity (database)', () => {
  it('keeps the measurement child equal to the session child (audit finding W1)', async () => {
    const a = await childWithConsent();
    const b = await childWithConsent();
    const s = await newSession(a.childId, a.consentId);
    await expect(measure(b.childId, s.id)).rejects.toThrow(/does not match the screening session child/);
  });

  it('is insert-only: corrections supersede with a reason and keep the original', async () => {
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    const original = await measure(c.childId, s.id);
    await expect(
      prisma.measurement.update({ where: { id: original.id }, data: { value: 11 } }),
    ).rejects.toThrow(/insert-only/);
    await expect(prisma.measurement.delete({ where: { id: original.id } })).rejects.toThrow(/insert-only/);
    await expect(measure(c.childId, s.id, { supersedesId: original.id })).rejects.toThrow(
      /measurement_correction_complete/,
    );
    await expect(
      measure(c.childId, s.id, {
        supersedesId: original.id,
        correctionReason: 'Typo',
        type: 'HEIGHT',
        unit: 'cm',
      }),
    ).rejects.toThrow(/same child, session and measurement type/);

    const corrected = await measure(c.childId, s.id, {
      supersedesId: original.id,
      correctionReason: 'Typo',
      value: 10.8,
    });
    await expect(
      measure(c.childId, s.id, { supersedesId: original.id, correctionReason: 'Again' }),
    ).rejects.toThrow(/supersedesId|Unique constraint/);
    const history = await prisma.measurement.findMany({
      where: { sessionId: s.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((m) => [m.id, m.value.toString()])).toEqual([
      [original.id, '10.5'],
      [corrected.id, '10.8'],
    ]);
  });

  it('rejects zero and negative values (CHECK)', async () => {
    const c = await childWithConsent();
    const s = await newSession(c.childId, c.consentId);
    await expect(measure(c.childId, s.id, { value: 0 })).rejects.toThrow(/measurement_value_positive/);
  });
});

// ================================================================ protocol read API

describe('GET /screening-protocols', () => {
  beforeAll(async () => {
    expect(await ensureDemoProtocols(prisma)).toEqual([]);
    expect(await ensureDemoProtocols(prisma)).toEqual([]); // idempotent, no drift
  });

  it('requires authentication and a screening or child-read permission', async () => {
    expect((await request(app).get('/api/v1/screening-protocols')).status).toBe(401);
    expect((await (await as('dadmin1')).get('/screening-protocols')).status).toBe(403);
    expect((await (await as('sup1')).get('/screening-protocols')).status).toBe(200); // child.read
    expect((await (await as('asha1')).get('/screening-protocols')).status).toBe(200);
  });

  it('lists demonstration drafts outside production, clearly marked as not approved', async () => {
    const res = await (await as('asha1')).get('/screening-protocols');
    const items = screeningProtocolListResponseSchema.parse(res.body).items;
    const demos = items.filter((i) => i.isDemonstration);
    expect(demos.map((d) => d.code).sort()).toEqual(['DEMO_D1', 'DEMO_D2', 'DEMO_D3', 'DEMO_D4']);
    expect(demos.every((d) => d.status === 'DRAFT' && !d.isClinicallyApproved)).toBe(true);
  });

  it('hides every draft and in-review protocol in production; shows ACTIVE and history', async () => {
    const asha = await as('asha1', prodApp);
    const items = screeningProtocolListResponseSchema.parse(
      (await asha.get('/screening-protocols')).body,
    ).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === 'ACTIVE' && i.isClinicallyApproved)).toBe(true);

    const demo = await prisma.screeningProtocol.findFirstOrThrow({ where: { code: 'DEMO_D1' } });
    expect((await asha.get(`/screening-protocols/${demo.id}`)).status).toBe(404);
    const retired = await prisma.screeningProtocol.findFirstOrThrow({ where: { status: 'RETIRED' } });
    expect((await asha.get(`/screening-protocols/${retired.id}`)).status).toBe(200);
  });

  it('returns the full validated content of one version, with bilingual wording', async () => {
    const demo = await prisma.screeningProtocol.findFirstOrThrow({ where: { code: 'DEMO_D2' } });
    const res = await (await as('asha1')).get(`/screening-protocols/${demo.id}`);
    expect(res.status).toBe(200);
    const { protocol } = screeningProtocolDetailResponseSchema.parse(res.body);
    const expected = DEMO_PROTOCOLS.find((p) => p.code === 'DEMO_D2')!;
    expect(protocol.questions.map((q) => q.code)).toEqual(expected.questions.map((q) => q.code));
    expect(protocol.questions[0]!.prompt.hi).toMatch(/^प्रदर्शन प्रश्न/);
    expect(protocol.contentSha256).toBeNull(); // drafts have no reviewed hash
  });

  it('lists every visible version of a code and validates ids', async () => {
    const v1 = await createProtocol({ code: 'VERSIONED_P', version: 1 });
    await createProtocol({ code: 'VERSIONED_P', version: 2 });
    const res = await (await as('asha1')).get(`/screening-protocols/${v1.row.id}/versions`);
    expect(screeningProtocolListResponseSchema.parse(res.body).items.map((i) => i.version)).toEqual([2, 1]);
    expect((await (await as('asha1')).get('/screening-protocols/not-a-uuid')).status).toBe(400);
    expect((await (await as('asha1')).get(`/screening-protocols/${randomUUID()}`)).status).toBe(404);
    expect((await (await as('asha1')).get('/screening-protocols?category=NOT_A_D')).status).toBe(400);
    expect((await (await as('asha1')).get('/screening-protocols?extra=1')).status).toBe(400);
  });
});

// ===================================================================== eligibility

describe('GET /children/:childId/screening-eligibility', () => {
  async function registerChild(body: Record<string, unknown>) {
    seq += 1;
    const res = await (
      await as('asha1')
    ).post('/children', {
      clientOperationId: randomUUID(),
      fullName: `Synthetic Eligible Child ${'abcdefghijklmnopqrstuvwxyz'[seq % 26]}${'zyxwvutsrqponmlkjihgfedcba'[(seq * 7) % 26]}`,
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
      ...body,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const child = childDetailResponseSchema.parse(res.body).child;
    return { id: child.id, mother: child.guardians[0]!.guardianId };
  }

  async function grantScreening(childId: string, guardianId: string) {
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
      decision: 'GRANTED',
      method: 'SIGNATURE',
      templateId: template.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.consent.id as string;
  }

  async function eligibility(childId: string, login = 'asha1', target = app) {
    return (await as(login, target)).get(`/children/${childId}/screening-eligibility`);
  }

  it('blocks screening until SCREENING consent is granted (no bypass)', async () => {
    const child = await registerChild({ dateOfBirth: '2016-03-10', sexAtBirth: 'MALE' });
    const before = screeningEligibilityResponseSchema.parse((await eligibility(child.id)).body);
    expect(before.canStart).toBe(false);
    expect(before.blockers).toContain('CONSENT_NOT_PERMITTED');
    expect(before.consent.status).toBe('NOT_RECORDED');

    await grantScreening(child.id, child.mother);
    const after = screeningEligibilityResponseSchema.parse((await eligibility(child.id)).body);
    expect(after.consent.permitted).toBe(true);
    expect(after.canStart).toBe(true);
    expect(after.blockers).toEqual([]);
    // Older than the fixture's SYN band (3000 days): one demo protocol per category.
    expect(after.categories.map((c) => [c.category, c.protocol?.code])).toEqual([
      ['DEFECTS_AT_BIRTH', 'DEMO_D1'],
      ['DEFICIENCIES', 'DEMO_D2'],
      ['DISEASES', 'DEMO_D3'],
      ['DEVELOPMENTAL_DELAYS_DISABILITIES', 'DEMO_D4'],
    ]);
    expect(after.usesUnapprovedContent).toBe(true);
    expect(after.screeningDate).toBe('2026-11-21');
    expect(after.ageInDays).toBe(3908); // 2016-03-10 -> 2026-11-21, calendar days
    expect(after.age).toEqual({ years: 10, months: 8 });
  });

  it('refuses to choose when two draft protocols cover the same age (configuration error)', async () => {
    const child = await registerChild({ dateOfBirth: '2025-01-15', sexAtBirth: 'FEMALE' });
    await grantScreening(child.id, child.mother);
    const body = screeningEligibilityResponseSchema.parse((await eligibility(child.id)).body);
    const deficiencies = body.categories.find((c) => c.category === 'DEFICIENCIES')!;
    // The fixture's SYN draft (0-3000 days) and DEMO_D2 both cover a 1-year-old.
    expect(deficiencies).toMatchObject({ available: false, reason: 'AMBIGUOUS_PROTOCOL', protocol: null });
  });

  it('flags an estimated date of birth', async () => {
    const child = await registerChild({ ageEstimate: { years: 9, months: 0 }, sexAtBirth: 'FEMALE' });
    const body = screeningEligibilityResponseSchema.parse((await eligibility(child.id)).body);
    expect(body.dobIsEstimated).toBe(true);
    expect(body.age).toEqual({ years: 9, months: 0 });
  });

  it('uses only ACTIVE protocols in production (demo drafts never offered)', async () => {
    const child = await registerChild({ dateOfBirth: '2016-05-01', sexAtBirth: 'FEMALE' });
    await grantScreening(child.id, child.mother);
    const body = screeningEligibilityResponseSchema.parse(
      (await eligibility(child.id, 'asha1', prodApp)).body,
    );
    expect(body.categories.every((c) => c.protocol === null || c.protocol.isClinicallyApproved)).toBe(true);
    expect(body.categories.find((c) => c.category === 'DEFECTS_AT_BIRTH')!.reason).toBe(
      'NO_PROTOCOL_FOR_AGE',
    );
    expect(body.usesUnapprovedContent).toBe(false);
  });

  it('points to the open session instead of allowing a second one', async () => {
    const child = await registerChild({ dateOfBirth: '2016-07-01', sexAtBirth: 'MALE' });
    const consentId = await grantScreening(child.id, child.mother);
    const session = await newSession(child.id, consentId, 3800);
    const body = screeningEligibilityResponseSchema.parse((await eligibility(child.id)).body);
    expect(body.openSessionId).toBe(session.id);
    expect(body.canStart).toBe(false);
    expect(body.blockers).toEqual(['OPEN_SESSION_EXISTS']);
  });

  it('enforces permission and area scope: out of scope is 404 and audited', async () => {
    const child = await registerChild({ dateOfBirth: '2016-08-01', sexAtBirth: 'MALE' });
    expect((await eligibility(child.id, 'sup1')).status).toBe(403); // no screening.conduct
    const res = await eligibility(child.id, 'asha5'); // other district
    expect(res.status).toBe(404);
    expect((await eligibility(randomUUID(), 'asha1')).status).toBe(404);
    const denied = await prisma.auditLog.findFirst({
      where: { action: 'child.access_denied', entityId: child.id, actorUserId: fx.user.asha5! },
    });
    expect(denied).toMatchObject({ outcome: 'DENIED' });
    expect((await eligibility('not-a-uuid')).status).toBe(400);
  });
});
