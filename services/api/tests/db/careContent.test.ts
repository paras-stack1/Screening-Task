import {
  careContentDefinitionSchema,
  careContentDetailResponseSchema,
  careContentListResponseSchema,
  type CareContentDefinition,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import {
  changeCareContentStatus,
  importCareContent,
} from '../../src/modules/care-content/careContentLifecycle';
import { ensureDemoCareContent } from '../../src/modules/care-content/demoCareContent';
import { DAY, testAuthConfig } from './authFixture';
import { api, buildAuthzFixture, TestClock, tokenFor, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 8B: Parent Care content library - lifecycle (CLI path), database rules and the read API,
 * against the real database. All content is SYNTHETIC. Users (authzFixture): asha1 (worker, V1),
 * sup1 (supervisor, child.read), dadmin1 (district admin: no child access); mht1 is created here
 * as a medical officer (holds screening.review, the assumed content approver - decision C4).
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let devApp: ReturnType<typeof createApp>;
let prodApp: ReturnType<typeof createApp>;
const tokens = new Map<string, string>();

async function as(login: string, app = devApp) {
  if (!tokens.has(login)) tokens.set(login, await tokenFor(devApp, login));
  return api(app, tokens.get(login)!);
}

function appWith(allowDraft: boolean) {
  return createApp({
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
    consentPolicy: { allowDraftNotices: allowDraft },
    screeningPolicy: { allowDraftProtocols: allowDraft },
  });
}

const real = (code: string, version: number, extra: Partial<CareContentDefinition> = {}) =>
  careContentDefinitionSchema.parse({
    dslVersion: 1,
    code,
    version,
    kind: 'ACTIVITY',
    topic: 'DEVELOPMENT_MOTOR',
    category: null,
    title: { en: `Synthetic activity v${version}`, hi: `Synthetic activity v${version}` },
    summary: { en: 'Synthetic summary', hi: 'Synthetic summary' },
    ageMinDays: 100,
    ageMaxDays: 400,
    steps: [{ en: 'Synthetic step', hi: 'Synthetic step' }],
    suggestedFrequency: { en: 'Synthetic frequency', hi: 'Synthetic frequency' },
    requiresDoctor: false,
    sourceReference: 'SYNTHETIC TEST SOURCE',
    usagePermission: 'SYNTHETIC TEST PERMISSION',
    isDemonstration: false,
    ...extra,
  });

const status = (
  code: string,
  version: number,
  to: 'IN_REVIEW' | 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'RETIRED',
  more: object = {},
) =>
  changeCareContentStatus(
    prisma,
    { code, version, to, actorLoginId: 'MHT1', approvalReference: 'SYN-MINUTE-1', ...more },
    clock.now(),
  );

async function list(app: ReturnType<typeof createApp>, query = '') {
  const res = await (await as('asha1', app)).get(`/care-content${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return careContentListResponseSchema.parse(res.body).items;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  devApp = appWith(true);
  prodApp = appWith(false);
  fx = await buildAuthzFixture(prisma, clock);
  const asha = await prisma.user.findUniqueOrThrow({ where: { id: fx.user.asha1! } });
  const mht = await prisma.user.create({
    data: {
      loginId: 'MHT1',
      passwordHash: asha.passwordHash,
      displayName: 'Synthetic Medical Officer',
      mustChangePassword: false,
    },
  });
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
  await ensureDemoCareContent(prisma);
  await ensureDemoCareContent(prisma); // idempotent
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

// ===================================================================== read API

describe('care content read API', () => {
  it('who may read: workers and supervisors yes, administrators no, nobody without a token', async () => {
    expect((await (await as('asha1')).get('/care-content')).status).toBe(200);
    expect((await (await as('sup1')).get('/care-content')).status).toBe(200);
    expect((await (await as('MHT1')).get('/care-content')).status).toBe(200);
    expect((await (await as('dadmin1')).get('/care-content')).status).toBe(403);
    expect((await request(devApp).get('/api/v1/care-content')).status).toBe(401);
  });

  it('outside production the demonstration library is offered, clearly labelled', async () => {
    const items = await list(devApp);
    expect(items.map((i) => i.code).sort()).toEqual([
      'DEMO_CARE_A1',
      'DEMO_CARE_A2',
      'DEMO_CARE_A3',
      'DEMO_CARE_V1',
      'DEMO_CARE_V2',
    ]);
    for (const item of items) {
      expect(item).toMatchObject({ status: 'DRAFT', isDemonstration: true, isClinicallyApproved: false });
    }
    const v1 = items.find((i) => i.code === 'DEMO_CARE_V1')!;
    expect(v1.video).toEqual({
      durationSeconds: 60,
      sizeBytes: 5_000_000,
      languages: ['hi'],
      hasCaptions: false,
    });
    expect(JSON.stringify(v1)).not.toContain('https://'); // the link only in the detail
  });

  it('filters by kind, topic and age', async () => {
    expect((await list(devApp, '?kind=VIDEO')).map((i) => i.kind)).toEqual(['VIDEO', 'VIDEO']);
    expect((await list(devApp, '?topic=HYGIENE')).map((i) => i.code)).toEqual(['DEMO_CARE_V2']);
    expect(await list(devApp, '?ageDays=6999')).toEqual([]); // beyond the demonstration band
    expect((await (await as('asha1')).get('/care-content?ageDays=abc')).status).toBe(400);
    expect((await (await as('asha1')).get('/care-content?guardianId=x')).status).toBe(400);
  });

  it('detail carries steps, frequency text and the video link', async () => {
    const items = await list(devApp);
    const activity = items.find((i) => i.code === 'DEMO_CARE_A1')!;
    const a = careContentDetailResponseSchema.parse(
      (await (await as('asha1')).get(`/care-content/${activity.id}`)).body,
    ).content;
    expect(a.steps).toHaveLength(3);
    expect(a.suggestedFrequency?.en).toMatch(/placeholder/);
    expect(a.videoUrl).toBeNull();
    const video = items.find((i) => i.code === 'DEMO_CARE_V1')!;
    const v = careContentDetailResponseSchema.parse(
      (await (await as('asha1')).get(`/care-content/${video.id}`)).body,
    ).content;
    expect(v.videoUrl).toBe('https://media.demo.invalid/care/v1');
    expect(v.steps).toEqual([]);
  });

  it('in production no demonstration or draft content is offered or readable', async () => {
    const drafts = await list(devApp);
    expect(await list(prodApp)).toEqual([]);
    expect((await (await as('asha1', prodApp)).get(`/care-content/${drafts[0]!.id}`)).status).toBe(404);
  });

  it('there is no write API', async () => {
    expect((await (await as('MHT1')).post('/care-content', {})).status).toBe(404);
    const id = (await list(devApp))[0]!.id;
    expect((await (await as('MHT1')).patch(`/care-content/${id}`, {})).status).toBe(404);
    expect((await (await as('MHT1')).delete(`/care-content/${id}`)).status).toBe(404);
  });
});

// ===================================================================== lifecycle (CLI path)

describe('care content lifecycle', () => {
  it('imports as DRAFT once; same version with other content is refused; real content needs an actor', async () => {
    const { id, created } = await importCareContent(prisma, real('SYN_CARE', 1), 'MHT1');
    expect(created).toBe(true);
    expect(await importCareContent(prisma, real('SYN_CARE', 1), 'MHT1')).toEqual({ id, created: false });
    await expect(
      importCareContent(prisma, real('SYN_CARE', 1, { summary: { en: 'Other', hi: 'Other' } }), 'MHT1'),
    ).rejects.toMatchObject({ code: 'VERSION_EXISTS' });
    await expect(importCareContent(prisma, real('SYN_OTHER', 1), null)).rejects.toMatchObject({
      code: 'ACTOR_REQUIRED',
    });
    const row = await prisma.careContent.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'DRAFT', contentSha256: null });
    expect(await prisma.careContentEvent.count({ where: { contentId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'care_content.created' } })).toBe(1);
  });

  it('approval: only a screening.review holder, only with a reference, only valid transitions', async () => {
    await expect(status('SYN_CARE', 1, 'APPROVED')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await status('SYN_CARE', 1, 'IN_REVIEW');
    expect(
      (await prisma.careContent.findFirstOrThrow({ where: { code: 'SYN_CARE' } })).contentSha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      changeCareContentStatus(
        prisma,
        { code: 'SYN_CARE', version: 1, to: 'APPROVED', actorLoginId: 'asha1', approvalReference: 'X-1' },
        clock.now(),
      ),
    ).rejects.toMatchObject({ code: 'APPROVER_NOT_AUTHORISED' });
    await expect(status('SYN_CARE', 1, 'APPROVED', { approvalReference: '  ' })).rejects.toMatchObject({
      code: 'APPROVAL_REFERENCE_REQUIRED',
    });
    await status('SYN_CARE', 1, 'APPROVED');
    // Approved but not yet ACTIVE: not offered anywhere.
    expect((await list(prodApp)).map((i) => i.code)).not.toContain('SYN_CARE');
    await status('SYN_CARE', 1, 'ACTIVE', { effectiveFrom: new Date(clock.now().getTime() + DAY) });
    expect((await list(prodApp)).map((i) => i.code)).not.toContain('SYN_CARE'); // future date
    clock.advance(DAY);
    tokens.clear(); // access tokens from before the jump have expired
    const offered = await list(prodApp);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({
      code: 'SYN_CARE',
      version: 1,
      status: 'ACTIVE',
      isDemonstration: false,
      isClinicallyApproved: true,
      approvalReference: 'SYN-MINUTE-1',
    });
    expect(await list(prodApp, '?ageDays=99')).toEqual([]);
    expect(await list(prodApp, '?ageDays=100')).toHaveLength(1);
    const events = await prisma.careContentEvent.findMany({
      where: { content: { code: 'SYN_CARE' } },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => e.toStatus)).toEqual(['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE']);
  });

  it('one ACTIVE version per code; the new version replaces the old after retirement', async () => {
    await importCareContent(prisma, real('SYN_CARE', 2), 'MHT1');
    // While drafts are allowed, the ACTIVE version still wins over a newer draft.
    expect((await list(devApp)).find((i) => i.code === 'SYN_CARE')).toMatchObject({ version: 1 });
    await status('SYN_CARE', 2, 'IN_REVIEW');
    await status('SYN_CARE', 2, 'APPROVED');
    await expect(status('SYN_CARE', 2, 'ACTIVE')).rejects.toMatchObject({ code: 'ACTIVE_VERSION_EXISTS' });
    await status('SYN_CARE', 1, 'RETIRED');
    await status('SYN_CARE', 2, 'ACTIVE');
    expect((await list(prodApp)).map((i) => [i.code, i.version])).toEqual([['SYN_CARE', 2]]);
    // A retired version stays readable (plans made with it keep their history).
    const v1 = await prisma.careContent.findFirstOrThrow({ where: { code: 'SYN_CARE', version: 1 } });
    expect((await (await as('asha1', prodApp)).get(`/care-content/${v1.id}`)).status).toBe(200);
  });

  it('demonstration content can never be approved', async () => {
    await status('DEMO_CARE_A2', 1, 'IN_REVIEW');
    await expect(status('DEMO_CARE_A2', 1, 'APPROVED')).rejects.toMatchObject({
      code: 'DEMONSTRATION_NOT_APPROVABLE',
    });
    const mht = await prisma.user.findUniqueOrThrow({ where: { loginId: 'MHT1' } });
    await expect(
      prisma.careContent.updateMany({
        where: { code: 'DEMO_CARE_A2' },
        data: {
          status: 'APPROVED',
          approvedById: mht.id,
          approvedAt: clock.now(),
          approvalReference: 'FORGED',
        },
      }),
    ).rejects.toThrow(/care_content_approval_complete/);
    await status('DEMO_CARE_A2', 1, 'DRAFT');
  });
});

// ===================================================================== database rules

describe('care content database rules', () => {
  it('content is frozen after DRAFT; drafts may still be corrected', async () => {
    await expect(
      prisma.careContent.updateMany({
        where: { code: 'SYN_CARE', version: 2 },
        data: { summaryEn: 'Changed after approval' },
      }),
    ).rejects.toThrow(/frozen/);
    await expect(
      prisma.careContent.updateMany({
        where: { code: 'SYN_CARE', version: 2 },
        data: { approvalReference: 'REWRITTEN' },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.careContent.updateMany({ where: { code: 'SYN_CARE', version: 1 }, data: { status: 'ACTIVE' } }),
    ).rejects.toThrow(/status cannot change from RETIRED to ACTIVE/);
    const ok = await prisma.careContent.updateMany({
      where: { code: 'DEMO_CARE_A1' },
      data: { summaryEn: 'Placeholder for software testing. Not health or parenting guidance.' },
    });
    expect(ok.count).toBe(1);
  });

  it('nothing is deleted and history is append-only', async () => {
    await expect(prisma.careContent.deleteMany({ where: { code: 'DEMO_CARE_A1' } })).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      prisma.careContentEvent.updateMany({
        where: { content: { code: 'SYN_CARE' } },
        data: { reference: 'x' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.careContentEvent.deleteMany({ where: { content: { code: 'SYN_CARE' } } }),
    ).rejects.toThrow(/append-only/);
  });

  it('a video row must carry a video and an activity row must carry steps', async () => {
    const base = {
      code: 'SYN_SHAPE',
      version: 1,
      topic: 'HYGIENE' as const,
      titleEn: 't',
      titleHi: 't',
      summaryEn: 's',
      summaryHi: 's',
      ageMinDays: 0,
      ageMaxDays: 10,
      sourceReference: 'SYNTHETIC',
      usagePermission: 'SYNTHETIC',
      isDemonstration: true,
    };
    await expect(
      prisma.careContent.create({
        data: { ...base, kind: 'VIDEO', definition: { dslVersion: 1, steps: [] } },
      }),
    ).rejects.toThrow(/care_content_kind_shape/);
    await expect(
      prisma.careContent.create({ data: { ...base, kind: 'ACTIVITY', definition: { dslVersion: 1 } } }),
    ).rejects.toThrow(/care_content_kind_shape/);
    await expect(
      prisma.careContent.create({
        data: { ...base, isDemonstration: false, kind: 'ACTIVITY', definition: { dslVersion: 1, steps: [] } },
      }),
    ).rejects.toThrow(/care_content_creator/);
  });
});
