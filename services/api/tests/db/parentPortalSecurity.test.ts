import { randomUUID } from 'node:crypto';
import {
  childDetailResponseSchema,
  parentChildListResponseSchema,
  parentTokensResponseSchema,
  verifyOtpResponseSchema,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import type { AuthConfig } from '../../src/config/security';
import { createMockSmsSender, type MockSmsSender } from '../../src/integrations/sms/smsSender';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { logger } from '../../src/utils/logger';
import { DAY, testAuthConfig } from './authFixture';
import { buildAuthzFixture, PASSWORD, TestClock, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 8 Parent Portal, stage 7: end-to-end security checks across the whole journey
 * (invite -> code -> activation -> login -> children -> logout), complementing the per-stage tests
 * (parentInvitations, parentOnboarding, parentAuth, parentChildren). Synthetic data only.
 */
const PARENT_PASSWORD = 'Banyan-shade-at-noon-63';
const parentAuthConfig: AuthConfig = {
  ...testAuthConfig,
  jwt: { ...testAuthConfig.jwt, audience: 'balswasthya-parent-portal' },
  refresh: { idleTtlMs: 30 * DAY, absoluteTtlMs: 90 * DAY, reuseGraceMs: 30_000 },
};
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let sms: MockSmsSender;
let app: ReturnType<typeof createApp>;
let staffToken: string;

const pub = (path: string, body: object) => request(app).post(`/api/v1/parent${path}`).send(body);
const staffPost = (path: string, body: object) =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${staffToken}`).send(body);
const lastCode = () => [...sms.outbox].reverse().find((m) => m.templateId === 'PARENT_OTP')!.params.code!;

let seq = 0;
async function household(phone: string) {
  const i = seq++;
  const name = `Synthetic Secure Child ${String.fromCharCode(97 + i)}`;
  const res = await staffPost('/children', {
    clientOperationId: randomUUID(),
    fullName: name,
    dateOfBirth: new Date(Date.UTC(2022, 1, 1) + i * 45 * DAY).toISOString().slice(0, 10),
    areaId: fx.area.V1!,
    guardians: [
      {
        newGuardian: { fullName: `${name} Mother`, phone },
        relationship: 'MOTHER',
        isPrimaryContact: true,
        canGiveConsent: true,
      },
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const child = childDetailResponseSchema.parse(res.body).child;
  return { childId: child.id, name: child.fullName, guardianId: child.guardians[0]!.guardianId };
}

/** Every secret a journey produces, to search for afterwards. */
const secrets: string[] = [];
const logged: string[] = [];
let mine: Awaited<ReturnType<typeof household>>;
let theirs: Awaited<ReturnType<typeof household>>;
let parentAccess: string;

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  sms = createMockSmsSender({ outboxFile: null });
  app = createApp({
    auth: {
      db: prisma,
      config: testAuthConfig,
      now: clock.now,
      rateLimits: { ...DEFAULT_RATE_LIMITS, loginPerIpAndAccount: 1000, loginPerIp: 1000 },
    },
    parentAuth: parentAuthConfig,
    parentPortal: {
      portalUrl: 'https://parent.example.test',
      inviteTtlHours: 24,
      sms,
      otpKey: Buffer.alloc(32, 11),
      allowDraftLegal: true,
      publicRateLimits: {
        validatePerIp: 10_000,
        sendOtpPerIp: 10_000,
        verifyOtpPerIp: 10_000,
        activatePerIp: 10_000,
      },
      authRateLimits: { loginPerIp: 10_000, refreshPerIp: 10_000, resetPerIp: 10_000, accountPerIp: 10_000 },
    },
  });
  fx = await buildAuthzFixture(prisma, clock);
  staffToken = (await request(app).post('/api/v1/auth/login').send({ loginId: 'asha1', password: PASSWORD }))
    .body.accessToken;

  // Capture everything the application logs during the journey.
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
    });
  }

  mine = await household('9700011122');
  theirs = await household('9700033344');

  // The whole journey for "mine".
  const inv = await staffPost(`/guardians/${mine.guardianId}/invitations`, {
    guardianAgreed: true,
    childIds: [mine.childId],
  });
  expect(inv.status).toBe(201);
  const token = sms.outbox.at(-1)!.params.link!.split('#')[1]!;
  secrets.push(token);
  expect((await pub('/invitations/validate', { token })).status).toBe(200);
  expect((await pub('/invitations/send-otp', { token })).status).toBe(200);
  const code = lastCode();
  secrets.push(code);
  const verified = await pub('/invitations/verify-otp', { token, code });
  const ticket = verifyOtpResponseSchema.parse(verified.body).activationTicket;
  secrets.push(ticket);
  const activated = await pub('/activate', {
    token,
    activationTicket: ticket,
    password: PARENT_PASSWORD,
    confirmPassword: PARENT_PASSWORD,
    privacyNoticeVersion: 'draft-1',
    termsVersion: 'draft-1',
    acceptPrivacyNotice: true,
    acceptTerms: true,
  });
  expect(activated.status).toBe(201);
  secrets.push(PARENT_PASSWORD);
  const login = await pub('/auth/login', { phone: '9700011122', password: PARENT_PASSWORD });
  expect(login.status).toBe(200);
  const tokens = parentTokensResponseSchema.parse(login.body);
  parentAccess = tokens.accessToken;
  secrets.push(tokens.accessToken, tokens.refreshToken);
  // A reset code too.
  expect((await pub('/auth/forgot-password', { phone: '9700011122' })).status).toBe(202);
  secrets.push(lastCode());
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});

describe('secrets never leave their place', () => {
  it('no token, code, ticket or password appears in any application log line', () => {
    expect(logged.length).toBeGreaterThan(0);
    const all = logged.join('\n');
    for (const secret of secrets) expect(all).not.toContain(secret);
  });

  it('no raw secret is stored in any Parent Portal table or the audit log', async () => {
    const tables = await Promise.all([
      prisma.parentInvitation.findMany(),
      prisma.otpChallenge.findMany(),
      prisma.parentAccount.findMany(),
      prisma.parentRefreshSession.findMany(),
      prisma.smsMessage.findMany(),
      prisma.auditLog.findMany({
        where: { OR: [{ action: { startsWith: 'parent' } }, { actorParentAccountId: { not: null } }] },
      }),
    ]);
    const dump = JSON.stringify(tables);
    for (const secret of secrets) expect(dump).not.toContain(secret);
    // Phone numbers only masked in SMS records.
    expect(JSON.stringify(tables[4])).not.toContain('9700011122');
  });

  it('parent responses are not cacheable', async () => {
    const res = await request(app)
      .get('/api/v1/parent/children')
      .set('Authorization', `Bearer ${parentAccess}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});

describe('parent and staff identities stay apart', () => {
  it.each([
    ['get', '/api/v1/children'],
    ['get', '/api/v1/auth/me'],
    ['get', '/api/v1/referrals'],
    ['get', '/api/v1/follow-ups'],
    ['post', '/api/v1/auth/logout-all'],
  ])('a parent token is refused on staff route %s %s', async (method, path) => {
    const res = await request(app)
      [method as 'get' | 'post'](path)
      .set('Authorization', `Bearer ${parentAccess}`);
    expect(res.status).toBe(401);
  });

  it('a parent token cannot use worker invitation or sharing routes', async () => {
    for (const path of [
      `/api/v1/guardians/${mine.guardianId}/invitations`,
      `/api/v1/guardians/${mine.guardianId}/child-access`,
    ]) {
      const res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${parentAccess}`)
        .send({ childIds: [theirs.childId] });
      expect(res.status).toBe(401);
    }
  });

  it('a staff token is refused on every parent route', async () => {
    for (const path of [
      '/api/v1/parent/children',
      `/api/v1/parent/children/${mine.childId}`,
      '/api/v1/parent/auth/me',
    ]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(401);
    }
  });
});

describe('the parent only ever reaches their own child', () => {
  it('ignores a guardian or child id smuggled into the query string', async () => {
    const res = await request(app)
      .get(`/api/v1/parent/children?guardianId=${theirs.guardianId}&childId=${theirs.childId}`)
      .set('Authorization', `Bearer ${parentAccess}`);
    const { children } = parentChildListResponseSchema.parse(res.body);
    expect(children.map((c) => c.childId)).toEqual([mine.childId]);
    expect(JSON.stringify(res.body)).not.toContain(theirs.name);
  });

  it('refuses extra fields that try to choose an account, guardian or role', async () => {
    const extra = await pub('/auth/login', {
      phone: '9700011122',
      password: PARENT_PASSWORD,
      guardianId: theirs.guardianId,
    });
    expect(extra.status).toBe(400);
    const role = await pub('/auth/login', {
      phone: '9700011122',
      password: PARENT_PASSWORD,
      role: 'MHT_MEDICAL_OFFICER',
    });
    expect(role.status).toBe(400);
  });

  it('after logout the same access token reaches nothing', async () => {
    const login = parentTokensResponseSchema.parse(
      (await pub('/auth/login', { phone: '9700011122', password: PARENT_PASSWORD })).body,
    );
    expect(
      (
        await request(app)
          .get(`/api/v1/parent/children/${mine.childId}`)
          .set('Authorization', `Bearer ${login.accessToken}`)
      ).status,
    ).toBe(200);
    expect((await pub('/auth/logout', { refreshToken: login.refreshToken })).status).toBe(204);
    expect(
      (
        await request(app)
          .get(`/api/v1/parent/children/${mine.childId}`)
          .set('Authorization', `Bearer ${login.accessToken}`)
      ).status,
    ).toBe(401);
  });
});
