import { randomUUID } from 'node:crypto';
import {
  activateParentAccountResponseSchema,
  childDetailResponseSchema,
  invitationValidationResponseSchema,
  parentLegalResponseSchema,
  sendOtpResponseSchema,
  verifyOtpResponseSchema,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import {
  createMockSmsSender,
  createNoSmsSender,
  type MockSmsSender,
} from '../../src/integrations/sms/smsSender';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import type { ParentPortalSettings } from '../../src/modules/parent-portal/invitations.service';
import { DAY, testAuthConfig } from './authFixture';
import { buildAuthzFixture, PASSWORD, TestClock, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 8 Parent Portal, stage 4: invitation validation, one-time codes and account activation,
 * through the real HTTP API and database. Synthetic data only.
 */
const PORTAL = 'https://parent.example.test';
const OTP_KEY = Buffer.alloc(32, 7);
const HIGH = { validatePerIp: 10_000, sendOtpPerIp: 10_000, verifyOtpPerIp: 10_000, activatePerIp: 10_000 };
const GOOD_PASSWORD = 'Neem-tree-by-the-well-42';
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
    parentPortal: {
      portalUrl: PORTAL,
      inviteTtlHours: 24,
      sms,
      otpKey: OTP_KEY,
      otpTtlMinutes: 5,
      allowDraftLegal: true,
      publicRateLimits: HIGH,
      ...overrides,
    },
  });
}

const tokens = new Map<string, string>();
async function staff(login: string) {
  if (!tokens.has(login)) {
    const res = await request(app).post('/api/v1/auth/login').send({ loginId: login, password: PASSWORD });
    tokens.set(login, res.body.accessToken as string);
  }
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tokens.get(login)!}`);
  return {
    post: (path: string, body?: object) => auth(request(app).post(`/api/v1${path}`)).send(body ?? {}),
    patch: (path: string, body?: object) => auth(request(app).patch(`/api/v1${path}`)).send(body ?? {}),
    get: (path: string) => auth(request(app).get(`/api/v1${path}`)),
  };
}
/** Moves the clock; long jumps also drop cached (15-minute) staff access tokens. */
function advance(ms: number) {
  clock.advance(ms);
  if (ms > 60_000) tokens.clear();
}

const pub = (path: string, body: object, target = app) =>
  request(target).post(`/api/v1/parent${path}`).send(body);

let seq = 0;
const letters = (n: number) =>
  `${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;

/** A child + guardian (with phone) in V1, invited by asha1. Returns ids, phone and the link token. */
async function invited() {
  const i = seq++;
  const name = `Synthetic Onboard Child ${letters(i)}`;
  const phone = `96${String(20_000_000 + i * 7_919).slice(0, 8)}`;
  const reg = await (
    await staff('asha1')
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: name,
    dateOfBirth: new Date(Date.UTC(2021, 0, 1) + i * 37 * DAY).toISOString().slice(0, 10),
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
  ).post(`/guardians/${guardianId}/invitations`, {
    guardianAgreed: true,
    childIds: [child.id],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const token = sms.outbox.at(-1)!.params.link!.split('#')[1]!;
  return { childId: child.id, childName: child.fullName, guardianId, phone, token };
}

const lastCode = () => {
  const m = [...sms.outbox].reverse().find((x) => x.templateId === 'PARENT_OTP')!;
  return m.params.code!;
};

async function verified(token: string) {
  const sent = await pub('/invitations/send-otp', { token });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const res = await pub('/invitations/verify-otp', { token, code: lastCode() });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return verifyOtpResponseSchema.parse(res.body).activationTicket;
}

const activation = (token: string, activationTicket: string, overrides: Record<string, unknown> = {}) => ({
  token,
  activationTicket,
  password: GOOD_PASSWORD,
  confirmPassword: GOOD_PASSWORD,
  privacyNoticeVersion: 'draft-1',
  termsVersion: 'draft-1',
  acceptPrivacyNotice: true,
  acceptTerms: true,
  ...overrides,
});

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

describe('invitation link', () => {
  it('validates a good token and shows only the masked number - no names', async () => {
    const h = await invited();
    const res = await pub('/invitations/validate', { token: h.token });
    expect(res.status).toBe(200);
    const body = invitationValidationResponseSchema.parse(res.body);
    expect(body).toMatchObject({ valid: true, phoneVerified: false });
    expect(body.maskedPhone).toMatch(/^\*+\d{4}$/);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(h.childName);
    expect(text).not.toContain('Mother');
    expect(text).not.toContain(h.phone);
  });

  it('gives one answer for unknown, revoked, replaced and expired links; malformed is 400', async () => {
    const unknown = await pub('/invitations/validate', { token: 'A'.repeat(43) });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('INVITATION_INVALID');
    expect((await pub('/invitations/validate', { token: 'short' })).status).toBe(400);
    expect((await pub('/invitations/validate', { token: 'A'.repeat(43), extra: 1 })).status).toBe(400);

    const replaced = await invited();
    advance(1000);
    await (
      await staff('asha1')
    ).post(`/guardians/${replaced.guardianId}/invitations`, {
      guardianAgreed: true,
      childIds: [replaced.childId],
    });
    expect((await pub('/invitations/validate', { token: replaced.token })).body.error.code).toBe(
      'INVITATION_INVALID',
    );

    const expired = await invited();
    advance(24 * 3_600_000 + 1000);
    const res = await pub('/invitations/validate', { token: expired.token });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVITATION_INVALID');
  });

  it('stops working when the guardian mobile number was changed after the invitation', async () => {
    const h = await invited();
    const g = await (await staff('asha1')).get(`/guardians/${h.guardianId}`);
    const patched = await (
      await staff('asha1')
    ).patch(`/guardians/${h.guardianId}`, {
      expectedUpdatedAt: g.body.guardian.updatedAt,
      phone: '9123456780',
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await pub('/invitations/validate', { token: h.token })).status).toBe(404);
  });
});

describe('one-time code', () => {
  it('sends a 6-digit code, stores only its HMAC, never returns it', async () => {
    const h = await invited();
    const res = await pub('/invitations/send-otp', { token: h.token });
    expect(res.status).toBe(200);
    sendOtpResponseSchema.parse(res.body);
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(code);
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { invitation: { guardianId: h.guardianId } },
    });
    expect(challenge.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.codeHash).not.toContain(code);
    expect(challenge).toMatchObject({ purpose: 'INVITATION', attempts: 0, maxAttempts: 5, consumedAt: null });
    expect(challenge.expiresAt.getTime() - clock.now().getTime()).toBe(5 * 60_000);
    const audits = await prisma.auditLog.findMany({ where: { action: { startsWith: 'parent_otp' } } });
    expect(JSON.stringify(audits)).not.toContain(code);
    const message = sms.outbox.at(-1)!;
    expect(message.text).not.toContain(h.childName);
  });

  it('refuses a resend within 60 s, and more than 5 codes per phone per hour', async () => {
    const h = await invited();
    expect((await pub('/invitations/send-otp', { token: h.token })).status).toBe(200);
    const soon = await pub('/invitations/send-otp', { token: h.token });
    expect(soon.status).toBe(429);
    expect(soon.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    for (let i = 0; i < 4; i++) {
      advance(61_000);
      expect((await pub('/invitations/send-otp', { token: h.token })).status).toBe(200);
    }
    advance(61_000);
    const limited = await pub('/invitations/send-otp', { token: h.token });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('OTP_LIMIT');
  });

  it('wrong code counts attempts; after 5 even the right code is refused (brute force)', async () => {
    const h = await invited();
    await pub('/invitations/send-otp', { token: h.token });
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    const first = await pub('/invitations/verify-otp', { token: h.token, code: wrong });
    expect(first.status).toBe(400);
    expect(first.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: 4 } });
    for (let i = 0; i < 4; i++) await pub('/invitations/verify-otp', { token: h.token, code: wrong });
    const locked = await pub('/invitations/verify-otp', { token: h.token, code: right });
    expect(locked.status).toBe(400);
    expect(locked.body.error.code).toBe('OTP_EXPIRED');
    const row = await prisma.otpChallenge.findFirstOrThrow({
      where: { invitation: { guardianId: h.guardianId } },
    });
    expect(row.attempts).toBe(5);
    expect(row.consumedAt).toBeNull();
  });

  it('parallel guesses never exceed the attempt limit', async () => {
    const h = await invited();
    await pub('/invitations/send-otp', { token: h.token });
    const wrong = lastCode() === '222222' ? '333333' : '222222';
    await Promise.all(
      Array.from({ length: 12 }, () => pub('/invitations/verify-otp', { token: h.token, code: wrong })),
    );
    const row = await prisma.otpChallenge.findFirstOrThrow({
      where: { invitation: { guardianId: h.guardianId } },
    });
    expect(row.attempts).toBe(5);
  });

  it('an expired code, a reused code and an older code are refused', async () => {
    const h = await invited();
    await pub('/invitations/send-otp', { token: h.token });
    const old = lastCode();
    advance(5 * 60_000 + 1000);
    expect((await pub('/invitations/verify-otp', { token: h.token, code: old })).body.error.code).toBe(
      'OTP_EXPIRED',
    );

    await pub('/invitations/send-otp', { token: h.token });
    const second = lastCode();
    advance(61_000);
    await pub('/invitations/send-otp', { token: h.token });
    const third = lastCode();
    if (second !== third) {
      expect((await pub('/invitations/verify-otp', { token: h.token, code: second })).status).toBe(400);
    }
    expect((await pub('/invitations/verify-otp', { token: h.token, code: third })).status).toBe(200);
    expect((await pub('/invitations/verify-otp', { token: h.token, code: third })).body.error.code).toBe(
      'OTP_EXPIRED',
    );
    const v = invitationValidationResponseSchema.parse(
      (await pub('/invitations/validate', { token: h.token })).body,
    );
    expect(v.phoneVerified).toBe(true);
  });

  it('without an SMS provider: 503, no code created, nothing claimed as sent', async () => {
    const h = await invited();
    const res = await pub(
      '/invitations/send-otp',
      { token: h.token },
      buildApp({ sms: createNoSmsSender() }),
    );
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SMS_NOT_CONFIGURED');
    expect(await prisma.otpChallenge.count({ where: { invitation: { guardianId: h.guardianId } } })).toBe(0);
  });

  it('without OTP_HMAC_KEY codes are unavailable (503)', async () => {
    const h = await invited();
    const res = await pub('/invitations/send-otp', { token: h.token }, buildApp({ otpKey: undefined }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('OTP_NOT_CONFIGURED');
  });
});

describe('activation', () => {
  it('serves the (placeholder) privacy notice and terms in Hindi and English', async () => {
    const hi = parentLegalResponseSchema.parse(
      (await request(app).get('/api/v1/parent/legal?language=hi')).body,
    );
    expect(hi.privacyNotice).toMatchObject({ version: 'draft-1', language: 'hi', isPlaceholder: true });
    expect(hi.privacyNotice.text).toMatch(/[ऀ-ॿ]/);
    const en = parentLegalResponseSchema.parse(
      (await request(app).get('/api/v1/parent/legal?language=en')).body,
    );
    expect(en.terms.text.startsWith('[PLACEHOLDER')).toBe(true);
  });

  it('is refused without a verified code (no ticket, forged ticket, another invitation ticket)', async () => {
    const h = await invited();
    const other = await invited();
    const otherTicket = await verified(other.token);
    for (const ticket of [
      'x',
      `${randomUUID()}.${randomUUID()}.${Date.now() + 60_000}.forged`,
      otherTicket,
    ]) {
      const res = await pub('/activate', activation(h.token, ticket));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PHONE_NOT_VERIFIED');
    }
    expect(await prisma.parentAccount.count({ where: { guardianId: h.guardianId } })).toBe(0);
  });

  it('activates: Argon2id hash, invitation used, children visible, no consent granted, audited as the parent', async () => {
    const h = await invited();
    const consentsBefore = await prisma.consent.count();
    const ticket = await verified(h.token);
    const res = await pub('/activate', activation(h.token, ticket));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(activateParentAccountResponseSchema.parse(res.body).maskedPhone).toMatch(/\d{4}$/);
    expect(JSON.stringify(res.body)).not.toContain(GOOD_PASSWORD);

    const account = await prisma.parentAccount.findUniqueOrThrow({ where: { guardianId: h.guardianId } });
    expect(account.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(account).toMatchObject({
      status: 'ACTIVE',
      privacyNoticeVersion: 'draft-1',
      termsVersion: 'draft-1',
    });
    const inv = await prisma.parentInvitation.findFirstOrThrow({
      where: { guardianId: h.guardianId, status: 'USED' },
    });
    expect(inv.usedAt).not.toBeNull();
    const access = await prisma.guardianChildAccess.findMany({ where: { guardianId: h.guardianId } });
    expect(access.map((a) => [a.childId, a.status])).toEqual([[h.childId, 'ACTIVE']]);
    expect(await prisma.consent.count()).toBe(consentsBefore);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'parent_account.activated', entityId: account.id },
    });
    expect(audit.actorParentAccountId).toBe(account.id);
    expect(audit.actorUserId).toBeNull();
    expect(JSON.stringify(audit)).not.toContain(GOOD_PASSWORD);

    // Single use: the link and the ticket are spent.
    expect((await pub('/activate', activation(h.token, ticket))).status).toBe(404);
    expect((await pub('/invitations/validate', { token: h.token })).status).toBe(404);
    // The worker card now shows ACTIVATED and refuses new invitations.
    const status = await (await staff('asha1')).get(`/guardians/${h.guardianId}/invitations`);
    expect(status.body.portal).toMatchObject({ status: 'ACTIVATED', blockedReason: 'ALREADY_ACTIVATED' });
  });

  it('enforces the password rules: common, contains the phone number, too short, mismatch', async () => {
    const h = await invited();
    const ticket = await verified(h.token);
    const cases: Array<[{ password?: string; confirmPassword: string }, number, string]> = [
      [{ password: 'password123', confirmPassword: 'password123' }, 422, 'WEAK_PASSWORD'],
      [{ password: `x${h.phone}y`, confirmPassword: `x${h.phone}y` }, 422, 'WEAK_PASSWORD'],
      [{ password: 'Ab1!', confirmPassword: 'Ab1!' }, 422, 'WEAK_PASSWORD'],
      [{ confirmPassword: 'Something-else-99' }, 400, 'VALIDATION_ERROR'],
    ];
    for (const [overrides, status, code] of cases) {
      const res = await pub('/activate', activation(h.token, ticket, overrides));
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(JSON.stringify(res.body)).not.toContain(overrides.password ?? GOOD_PASSWORD);
    }
    expect(await prisma.parentAccount.count({ where: { guardianId: h.guardianId } })).toBe(0);
  });

  it('requires accepting the current privacy notice and terms', async () => {
    const h = await invited();
    const ticket = await verified(h.token);
    expect((await pub('/activate', activation(h.token, ticket, { acceptTerms: false }))).status).toBe(400);
    expect(
      (await pub('/activate', activation(h.token, ticket, { acceptPrivacyNotice: undefined }))).status,
    ).toBe(400);
    const old = await pub('/activate', activation(h.token, ticket, { privacyNoticeVersion: 'draft-0' }));
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe('LEGAL_VERSION_CHANGED');
    // Production: placeholder wording cannot be accepted.
    const prod = await pub('/activate', activation(h.token, ticket), buildApp({ allowDraftLegal: false }));
    expect(prod.status).toBe(503);
    expect(prod.body.error.code).toBe('LEGAL_TEXT_NOT_APPROVED');
  });

  it('the activation ticket expires after 15 minutes', async () => {
    const h = await invited();
    const ticket = await verified(h.token);
    advance(15 * 60_000 + 1000);
    expect((await pub('/activate', activation(h.token, ticket))).status).toBe(403);
  });

  it('two parallel activations create exactly one account', async () => {
    const h = await invited();
    const ticket = await verified(h.token);
    const results = await Promise.all([
      pub('/activate', activation(h.token, ticket)),
      pub('/activate', activation(h.token, ticket)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 404]);
    expect(await prisma.parentAccount.count({ where: { guardianId: h.guardianId } })).toBe(1);
  });
});

describe('per-IP limits', () => {
  it('limits public onboarding calls per IP (429)', async () => {
    const limited = buildApp({ publicRateLimits: { ...HIGH, validatePerIp: 3 } });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await pub('/invitations/validate', { token: 'B'.repeat(43) }, limited)).status);
    expect(statuses).toEqual([404, 404, 404, 429]);
  });
});
