import { randomUUID } from 'node:crypto';
import {
  childDetailResponseSchema,
  parentMeResponseSchema,
  parentTokensResponseSchema,
  parentWebAuthResponseSchema,
  verifyOtpResponseSchema,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import type { AuthConfig } from '../../src/config/security';
import {
  createMockSmsSender,
  createNoSmsSender,
  type MockSmsSender,
} from '../../src/integrations/sms/smsSender';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import type { ParentPortalSettings } from '../../src/modules/parent-portal/invitations.service';
import { DAY, MINUTE, testAuthConfig } from './authFixture';
import { buildAuthzFixture, PASSWORD, TestClock, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 8 Parent Portal, stage 5: parent sign-in, sessions, logout, password change and reset,
 * mobile number change - through the real HTTP API and database. Synthetic data only.
 */
const PORTAL = 'https://parent.example.test';
const ORIGIN = 'http://localhost:8081'; // listed in CORS_ORIGINS for the DB tests
const PASSWORD_1 = 'Neem-tree-by-the-well-42';
const PASSWORD_2 = 'Mango-season-in-May-77';
/** Same key and issuer as staff (worst case): only the audience separates the two. */
const parentAuthConfig: AuthConfig = {
  ...testAuthConfig,
  jwt: { ...testAuthConfig.jwt, audience: 'balswasthya-parent-portal' },
  refresh: { idleTtlMs: 30 * DAY, absoluteTtlMs: 90 * DAY, reuseGraceMs: 30_000 },
};
const HIGH_PUBLIC = {
  validatePerIp: 10_000,
  sendOtpPerIp: 10_000,
  verifyOtpPerIp: 10_000,
  activatePerIp: 10_000,
};
const HIGH_AUTH = { loginPerIp: 10_000, refreshPerIp: 10_000, resetPerIp: 10_000, accountPerIp: 10_000 };

let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let sms: MockSmsSender;
let app: ReturnType<typeof createApp>;

function buildApp(overrides: Partial<ParentPortalSettings> = {}) {
  return createApp({
    auth: {
      db: prisma,
      config: testAuthConfig,
      now: clock.now,
      rateLimits: { ...DEFAULT_RATE_LIMITS, loginPerIpAndAccount: 1000, loginPerIp: 1000 },
    },
    parentAuth: parentAuthConfig,
    parentPortal: {
      portalUrl: PORTAL,
      inviteTtlHours: 24,
      sms,
      otpKey: Buffer.alloc(32, 9),
      otpTtlMinutes: 5,
      allowDraftLegal: true,
      publicRateLimits: HIGH_PUBLIC,
      authRateLimits: HIGH_AUTH,
      ...overrides,
    },
  });
}

const staffTokens = new Map<string, string>();
async function staffToken(login: string) {
  if (!staffTokens.has(login)) {
    const res = await request(app).post('/api/v1/auth/login').send({ loginId: login, password: PASSWORD });
    staffTokens.set(login, res.body.accessToken as string);
  }
  return staffTokens.get(login)!;
}
async function staff(login: string) {
  const token = await staffToken(login);
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(app).get(`/api/v1${path}`)),
    post: (path: string, body?: object) => auth(request(app).post(`/api/v1${path}`)).send(body ?? {}),
    patch: (path: string, body?: object) => auth(request(app).patch(`/api/v1${path}`)).send(body ?? {}),
  };
}
function advance(ms: number) {
  clock.advance(ms);
  if (ms > MINUTE) staffTokens.clear();
}
const pub = (path: string, body: object, target = app) =>
  request(target).post(`/api/v1/parent${path}`).send(body);
const asParent = (accessToken: string) => ({
  get: (path: string) =>
    request(app).get(`/api/v1/parent${path}`).set('Authorization', `Bearer ${accessToken}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(`/api/v1/parent${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body ?? {}),
});
const lastCode = () => [...sms.outbox].reverse().find((m) => m.templateId === 'PARENT_OTP')!.params.code!;

let seq = 0;
const letters = (n: number) =>
  `${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;
const freshPhone = () => `95${String(30_000_000 + seq++ * 6_563).slice(0, 8)}`;

/** A guardian with an ACTIVE parent account (invited, verified, activated). */
async function parent() {
  const i = seq++;
  const name = `Synthetic Login Child ${letters(i)}`;
  const phone = freshPhone();
  const reg = await (
    await staff('asha1')
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: name,
    dateOfBirth: new Date(Date.UTC(2020, 6, 1) + i * 29 * DAY).toISOString().slice(0, 10),
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
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  const child = childDetailResponseSchema.parse(reg.body).child;
  const guardianId = child.guardians[0]!.guardianId;
  const inv = await (
    await staff('asha1')
  ).post(`/guardians/${guardianId}/invitations`, { guardianAgreed: true, childIds: [child.id] });
  expect(inv.status).toBe(201);
  const token = sms.outbox.at(-1)!.params.link!.split('#')[1]!;
  expect((await pub('/invitations/send-otp', { token })).status).toBe(200);
  const verified = await pub('/invitations/verify-otp', { token, code: lastCode() });
  const activationTicket = verifyOtpResponseSchema.parse(verified.body).activationTicket;
  const act = await pub('/activate', {
    token,
    activationTicket,
    password: PASSWORD_1,
    confirmPassword: PASSWORD_1,
    privacyNoticeVersion: 'draft-1',
    termsVersion: 'draft-1',
    acceptPrivacyNotice: true,
    acceptTerms: true,
  });
  expect(act.status, JSON.stringify(act.body)).toBe(201);
  const account = await prisma.parentAccount.findUniqueOrThrow({ where: { guardianId } });
  return { phone, guardianId, childId: child.id, accountId: account.id };
}

async function login(phone: string, password = PASSWORD_1, target = app) {
  return pub('/auth/login', { phone, password }, target);
}
async function signedIn(phone: string, password = PASSWORD_1) {
  const res = await login(phone, password);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return parentTokensResponseSchema.parse(res.body);
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  sms = createMockSmsSender({ outboxFile: null });
  app = buildApp();
  fx = await buildAuthzFixture(prisma, clock);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('parent sign-in', () => {
  it('signs in with mobile number + password: fixed PARENT_GUARDIAN role, masked number, shared child count', async () => {
    const p = await parent();
    const tokens = await signedIn(`+91 ${p.phone}`);
    expect(tokens.account).toMatchObject({ id: p.accountId, role: 'PARENT_GUARDIAN', childCount: 1 });
    expect(tokens.account.maskedPhone).toMatch(/\d{4}$/);
    expect(JSON.stringify(tokens)).not.toContain(p.phone);
    const me = await asParent(tokens.accessToken).get('/auth/me');
    expect(me.status).toBe(200);
    expect(parentMeResponseSchema.parse(me.body).account.id).toBe(p.accountId);
  });

  it('wrong password and unknown number give the same answer; no role can be chosen', async () => {
    const p = await parent();
    const wrong = await login(p.phone, 'Not-the-password-11');
    const unknown = await login(freshPhone(), PASSWORD_1);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect({ ...wrong.body.error, requestId: 'x' }).toEqual({ ...unknown.body.error, requestId: 'x' });
    expect(
      (await pub('/auth/login', { phone: p.phone, password: PASSWORD_1, role: 'STATE_ADMIN' })).status,
    ).toBe(400);
  });

  it('locks sign-in after 5 wrong passwords without revealing it, then recovers', async () => {
    const p = await parent();
    for (let i = 0; i < 5; i++) expect((await login(p.phone, 'Not-the-password-11')).status).toBe(401);
    const locked = await login(p.phone);
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe('INVALID_CREDENTIALS');
    advance(2 * MINUTE);
    expect((await login(p.phone)).status).toBe(200);
  });

  it('parent and staff tokens are not interchangeable', async () => {
    const p = await parent();
    const tokens = await signedIn(p.phone);
    const asStaffRoute = await request(app)
      .get('/api/v1/children')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(asStaffRoute.status).toBe(401);
    const staffOnParent = await request(app)
      .get('/api/v1/parent/auth/me')
      .set('Authorization', `Bearer ${await staffToken('asha1')}`);
    expect(staffOnParent.status).toBe(401);
    expect((await request(app).get('/api/v1/parent/auth/me')).status).toBe(401);
  });

  it('a disabled account cannot sign in and its sessions stop at once', async () => {
    const p = await parent();
    const tokens = await signedIn(p.phone);
    await prisma.parentAccount.update({ where: { id: p.accountId }, data: { status: 'DISABLED' } });
    expect((await asParent(tokens.accessToken).get('/auth/me')).status).toBe(401);
    expect((await login(p.phone)).status).toBe(401);
    expect((await pub('/auth/refresh', { refreshToken: tokens.refreshToken })).status).toBe(401);
  });
});

describe('sessions', () => {
  it('refresh rotates; replaying an old token (after the grace window) ends the session family', async () => {
    const p = await parent();
    const first = await signedIn(p.phone);
    const rotated = await pub('/auth/refresh', { refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);
    const second = parentTokensResponseSchema.parse(rotated.body);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    advance(MINUTE);
    expect((await pub('/auth/refresh', { refreshToken: first.refreshToken })).status).toBe(401);
    expect((await pub('/auth/refresh', { refreshToken: second.refreshToken })).status).toBe(401);
    expect((await asParent(second.accessToken).get('/auth/me')).status).toBe(401);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'parent_auth.refresh_reuse_detected', entityId: p.accountId },
    });
    expect(audit).not.toBeNull();
  });

  it('logout invalidates the session immediately (access and refresh token)', async () => {
    const p = await parent();
    const tokens = await signedIn(p.phone);
    expect((await pub('/auth/logout', { refreshToken: tokens.refreshToken })).status).toBe(204);
    expect((await asParent(tokens.accessToken).get('/auth/me')).status).toBe(401);
    expect((await pub('/auth/refresh', { refreshToken: tokens.refreshToken })).status).toBe(401);
    // Unknown token: same 204 (no oracle).
    expect((await pub('/auth/logout', { refreshToken: 'unknown-token' })).status).toBe(204);
  });

  it('logout everywhere ends every device', async () => {
    const p = await parent();
    const a = await signedIn(p.phone);
    const b = await signedIn(p.phone);
    expect((await asParent(a.accessToken).post('/auth/logout-all')).status).toBe(204);
    expect((await asParent(a.accessToken).get('/auth/me')).status).toBe(401);
    expect((await asParent(b.accessToken).get('/auth/me')).status).toBe(401);
  });

  it('browser variant: listed origin + header required; refresh token only in an httpOnly SameSite=Strict cookie', async () => {
    const p = await parent();
    const body = { phone: p.phone, password: PASSWORD_1 };
    expect((await request(app).post('/api/v1/parent/auth/web/login').send(body)).status).toBe(403);
    expect(
      (await request(app).post('/api/v1/parent/auth/web/login').set('Origin', ORIGIN).send(body)).status,
    ).toBe(403);
    const res = await request(app)
      .post('/api/v1/parent/auth/web/login')
      .set('Origin', ORIGIN)
      .set('x-balswasthya-client', 'parent-portal')
      .send(body);
    expect(res.status).toBe(200);
    const parsed = parentWebAuthResponseSchema.parse(res.body);
    expect('refreshToken' in res.body).toBe(false);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/bs_parent_rt=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/parent\/auth\/web/);
    const refreshed = await request(app)
      .post('/api/v1/parent/auth/web/refresh')
      .set('Origin', ORIGIN)
      .set('x-balswasthya-client', 'parent-portal')
      .set('Cookie', cookie.split(';')[0]!);
    expect(refreshed.status).toBe(200);
    expect(parsed.account.role).toBe('PARENT_GUARDIAN');
  });
});

describe('password change and reset', () => {
  it('change: needs the current password; ends other sessions and returns a new one', async () => {
    const p = await parent();
    const other = await signedIn(p.phone);
    const current = await signedIn(p.phone);
    const wrong = await asParent(current.accessToken).post('/auth/change-password', {
      currentPassword: 'Not-the-password-11',
      newPassword: PASSWORD_2,
      confirmPassword: PASSWORD_2,
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('CURRENT_PASSWORD_WRONG');
    const ok = await asParent(current.accessToken).post('/auth/change-password', {
      currentPassword: PASSWORD_1,
      newPassword: PASSWORD_2,
      confirmPassword: PASSWORD_2,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const fresh = parentTokensResponseSchema.parse(ok.body);
    expect((await asParent(other.accessToken).get('/auth/me')).status).toBe(401);
    expect((await asParent(fresh.accessToken).get('/auth/me')).status).toBe(200);
    expect((await login(p.phone, PASSWORD_1)).status).toBe(401);
    expect((await login(p.phone, PASSWORD_2)).status).toBe(200);
  });

  it('forgot password answers the same for known and unknown numbers; only a real account gets a code', async () => {
    const p = await parent();
    const before = sms.outbox.length;
    const known = await pub('/auth/forgot-password', { phone: p.phone });
    const unknown = await pub('/auth/forgot-password', { phone: freshPhone() });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(sms.outbox.length).toBe(before + 1);
    expect(sms.outbox.at(-1)!.to).toBe(`+91${p.phone}`);
    // Without an SMS provider everyone gets the same 503.
    const off = buildApp({ sms: createNoSmsSender() });
    expect((await pub('/auth/forgot-password', { phone: p.phone }, off)).status).toBe(503);
    expect((await pub('/auth/forgot-password', { phone: freshPhone() }, off)).status).toBe(503);
  });

  it('reset: wrong code and unknown number look alike; success ends every session; the code works once', async () => {
    const p = await parent();
    const session = await signedIn(p.phone);
    await pub('/auth/forgot-password', { phone: p.phone });
    const code = lastCode();
    const wrongCode = code === '000000' ? '111111' : '000000';
    const body = (phone: string, c: string) => ({
      phone,
      code: c,
      newPassword: PASSWORD_2,
      confirmPassword: PASSWORD_2,
    });
    const wrong = await pub('/auth/reset-password', body(p.phone, wrongCode));
    const unknown = await pub('/auth/reset-password', body(freshPhone(), code));
    expect(wrong.status).toBe(400);
    expect({ ...wrong.body.error, requestId: 'x' }).toEqual({ ...unknown.body.error, requestId: 'x' });
    const weak = await pub('/auth/reset-password', {
      ...body(p.phone, code),
      newPassword: 'password1',
      confirmPassword: 'password1',
    });
    expect(weak.status).toBe(422);

    const ok = await pub('/auth/reset-password', body(p.phone, code));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await asParent(session.accessToken).get('/auth/me')).status).toBe(401);
    expect((await login(p.phone, PASSWORD_2)).status).toBe(200);
    expect((await pub('/auth/reset-password', body(p.phone, code))).status).toBe(400);
  });

  it('reset codes resist guessing: after 5 wrong tries the right code is refused', async () => {
    const p = await parent();
    await pub('/auth/forgot-password', { phone: p.phone });
    const code = lastCode();
    const wrong = code === '222222' ? '333333' : '222222';
    const body = (c: string) => ({
      phone: p.phone,
      code: c,
      newPassword: PASSWORD_2,
      confirmPassword: PASSWORD_2,
    });
    for (let i = 0; i < 5; i++) expect((await pub('/auth/reset-password', body(wrong))).status).toBe(400);
    expect((await pub('/auth/reset-password', body(code))).status).toBe(400);
    expect((await login(p.phone, PASSWORD_1)).status).toBe(200);
  });

  it('a reset also unlocks a locked sign-in', async () => {
    const p = await parent();
    for (let i = 0; i < 5; i++) await login(p.phone, 'Not-the-password-11');
    await pub('/auth/forgot-password', { phone: p.phone });
    const ok = await pub('/auth/reset-password', {
      phone: p.phone,
      code: lastCode(),
      newPassword: PASSWORD_2,
      confirmPassword: PASSWORD_2,
    });
    expect(ok.status).toBe(200);
    expect((await login(p.phone, PASSWORD_2)).status).toBe(200);
  });
});

describe('mobile number change (PP14)', () => {
  it('a worker cannot change or remove a number the parent verified', async () => {
    const p = await parent();
    const g = await (await staff('asha1')).get(`/guardians/${p.guardianId}`);
    for (const phone of ['9123456781', null]) {
      const res = await (
        await staff('asha1')
      ).patch(`/guardians/${p.guardianId}`, { expectedUpdatedAt: g.body.guardian.updatedAt, phone });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_VERIFIED_BY_PARENT');
    }
    // Other details can still be corrected.
    const name = await (
      await staff('asha1')
    ).patch(`/guardians/${p.guardianId}`, {
      expectedUpdatedAt: g.body.guardian.updatedAt,
      preferredLanguage: 'en',
    });
    expect(name.status).toBe(200);
  });

  it('the parent changes it with password + a code sent to the NEW number; other devices are signed out', async () => {
    const p = await parent();
    const other = await signedIn(p.phone);
    const current = await signedIn(p.phone);
    const newPhone = freshPhone();
    const api = asParent(current.accessToken);
    const wrongPw = await api.post('/auth/phone-change/start', {
      newPhone,
      currentPassword: 'Not-the-password-11',
    });
    expect(wrongPw.status).toBe(422);
    const same = await api.post('/auth/phone-change/start', {
      newPhone: p.phone,
      currentPassword: PASSWORD_1,
    });
    expect(same.body.error.code).toBe('SAME_PHONE');

    const start = await api.post('/auth/phone-change/start', { newPhone, currentPassword: PASSWORD_1 });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    expect(sms.outbox.at(-1)!.to).toBe(`+91${newPhone}`);
    const code = lastCode();
    // A code for a different number does not apply.
    expect((await api.post('/auth/phone-change/confirm', { newPhone: freshPhone(), code })).status).toBe(400);
    const ok = await api.post('/auth/phone-change/confirm', { newPhone, code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.account.maskedPhone).toMatch(new RegExp(`${newPhone.slice(-4)}$`));

    expect((await asParent(other.accessToken).get('/auth/me')).status).toBe(401);
    expect((await api.get('/auth/me')).status).toBe(200);
    expect((await login(p.phone)).status).toBe(401);
    expect((await login(newPhone)).status).toBe(200);
    // The worker sees the new number on the guardian record.
    const g = await (await staff('asha1')).get(`/guardians/${p.guardianId}`);
    expect(g.body.guardian.phone).toBe(`+91${newPhone}`);
  });

  it('refuses a number that another live parent account already uses', async () => {
    const a = await parent();
    const b = await parent();
    const tokens = await signedIn(a.phone);
    const api = asParent(tokens.accessToken);
    expect(
      (await api.post('/auth/phone-change/start', { newPhone: b.phone, currentPassword: PASSWORD_1 })).status,
    ).toBe(200);
    const res = await api.post('/auth/phone-change/confirm', { newPhone: b.phone, code: lastCode() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_IN_USE');
    expect((await login(a.phone)).status).toBe(200);
  });
});

describe('per-IP limits', () => {
  it('limits parent sign-in attempts per IP', async () => {
    const limited = buildApp({ authRateLimits: { loginPerIp: 2 } });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await login(freshPhone(), PASSWORD_1, limited)).status);
    expect(statuses).toEqual([401, 401, 429]);
  });
});
