import { randomUUID } from 'node:crypto';
import {
  childDetailResponseSchema,
  parentChildDetailResponseSchema,
  parentChildListResponseSchema,
  parentPortalStatusResponseSchema,
  parentTokensResponseSchema,
  verifyOtpResponseSchema,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import type { AuthConfig } from '../../src/config/security';
import { createMockSmsSender, type MockSmsSender } from '../../src/integrations/sms/smsSender';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { DAY, testAuthConfig } from './authFixture';
import { buildAuthzFixture, PASSWORD, TestClock, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 8 Parent Portal, stage 6: what a signed-in parent may see, and the worker controls for
 * sharing. IDOR/BOLA: a parent only ever reaches children shared with their own guardian record.
 * Synthetic data only.
 */
const PARENT_PASSWORD = 'Neem-tree-by-the-well-42';
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

const staffTokens = new Map<string, string>();
async function staff(login: string) {
  if (!staffTokens.has(login)) {
    const res = await request(app).post('/api/v1/auth/login').send({ loginId: login, password: PASSWORD });
    staffTokens.set(login, res.body.accessToken as string);
  }
  const t = staffTokens.get(login)!;
  return {
    get: (path: string) => request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${t}`),
    post: (path: string, body?: object) =>
      request(app)
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${t}`)
        .send(body ?? {}),
    delete: (path: string, body?: object) =>
      request(app)
        .delete(`/api/v1${path}`)
        .set('Authorization', `Bearer ${t}`)
        .send(body ?? {}),
  };
}
const pub = (path: string, body: object) => request(app).post(`/api/v1/parent${path}`).send(body);
const lastCode = () => [...sms.outbox].reverse().find((m) => m.templateId === 'PARENT_OTP')!.params.code!;
const parentApi = (token: string) => ({
  get: (path: string) => request(app).get(`/api/v1/parent${path}`).set('Authorization', `Bearer ${token}`),
});

let seq = 0;
const letters = (n: number) =>
  `${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;

/** Registers a child in `area`; a new guardian (with phone) or an existing one. */
async function child(area: string, guardian: { existingGuardianId: string } | 'new', login = 'asha1') {
  const i = seq++;
  const name = `Synthetic Family Child ${letters(i)}`;
  const link =
    guardian === 'new'
      ? {
          newGuardian: {
            fullName: `${name} Mother`,
            phone: `94${String(40_000_000 + i * 5_717).slice(0, 8)}`,
          },
          relationship: 'MOTHER',
          isPrimaryContact: true,
          canGiveConsent: true,
        }
      : {
          existingGuardianId: guardian.existingGuardianId,
          relationship: 'MOTHER',
          isPrimaryContact: true,
          canGiveConsent: true,
        };
  const res = await (
    await staff(login)
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: name,
    dateOfBirth: new Date(Date.UTC(2021, 3, 10) + i * 31 * DAY).toISOString().slice(0, 10),
    areaId: fx.area[area]!,
    guardians: [link],
    confirmNotDuplicate: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const c = childDetailResponseSchema.parse(res.body).child;
  return {
    childId: c.id,
    name: c.fullName,
    guardianId: c.guardians[0]!.guardianId,
    linkId: c.guardians[0]!.relationshipId,
  };
}

/** Invites the guardian for `childIds`, verifies, activates and signs in. Returns the access token. */
async function activateAndSignIn(guardianId: string, childIds: string[], phoneOf: string) {
  const inv = await (
    await staff('asha1')
  ).post(`/guardians/${guardianId}/invitations`, { guardianAgreed: true, childIds });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const token = sms.outbox.at(-1)!.params.link!.split('#')[1]!;
  await pub('/invitations/send-otp', { token });
  const ticket = verifyOtpResponseSchema.parse(
    (await pub('/invitations/verify-otp', { token, code: lastCode() })).body,
  ).activationTicket;
  const act = await pub('/activate', {
    token,
    activationTicket: ticket,
    password: PARENT_PASSWORD,
    confirmPassword: PARENT_PASSWORD,
    privacyNoticeVersion: 'draft-1',
    termsVersion: 'draft-1',
    acceptPrivacyNotice: true,
    acceptTerms: true,
  });
  expect(act.status, JSON.stringify(act.body)).toBe(201);
  const login = await pub('/auth/login', { phone: phoneOf, password: PARENT_PASSWORD });
  expect(login.status).toBe(200);
  return parentTokensResponseSchema.parse(login.body).accessToken;
}
async function phoneOfGuardian(guardianId: string) {
  const g = await (await staff('asha1')).get(`/guardians/${guardianId}`);
  return g.body.guardian.phone as string;
}

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
      otpKey: Buffer.alloc(32, 5),
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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('what a parent sees', () => {
  it('lists every shared child of the guardian - only name, age, centre, worker and dates', async () => {
    const a = await child('V1', 'new');
    const b = await child('V1', { existingGuardianId: a.guardianId });
    await prisma.followUp.create({
      data: {
        childId: a.childId,
        reasonCode: 'SYNTHETIC',
        dueDate: new Date('2026-12-15'),
        createdById: fx.user.asha1!,
      },
    });
    const token = await activateAndSignIn(
      a.guardianId,
      [a.childId, b.childId],
      await phoneOfGuardian(a.guardianId),
    );
    const res = await parentApi(token).get('/children');
    expect(res.status).toBe(200);
    const { children } = parentChildListResponseSchema.parse(res.body);
    expect(children.map((c) => c.childId).sort()).toEqual([a.childId, b.childId].sort());
    const first = children.find((c) => c.childId === a.childId)!;
    expect(first).toMatchObject({
      fullName: a.name,
      nextCheckUp: '2026-12-15',
      centre: { nameEn: 'Area V1' },
    });
    expect(first.workerName).toMatch(/^Synthetic /);
    // Nothing beyond the agreed fields (no results, notes, reasons, phones).
    expect(Object.keys(first).sort()).toEqual(
      [
        'ageMonths',
        'ageYears',
        'centre',
        'childId',
        'dobIsEstimated',
        'fullName',
        'nextAppointment',
        'nextCheckUp',
        'workerName',
      ].sort(),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/SYNTHETIC|reason|risk|phone/);

    const detail = await parentApi(token).get(`/children/${a.childId}`);
    expect(detail.status).toBe(200);
    expect(parentChildDetailResponseSchema.parse(detail.body).child.upcomingCheckUps).toEqual(['2026-12-15']);
  });

  it("cannot reach another family's child, an unknown id, or anything with a staff token (same 404, audited)", async () => {
    const mine = await child('V1', 'new');
    const theirs = await child('V1', 'new');
    const token = await activateAndSignIn(
      mine.guardianId,
      [mine.childId],
      await phoneOfGuardian(mine.guardianId),
    );
    const other = await parentApi(token).get(`/children/${theirs.childId}`);
    const unknown = await parentApi(token).get(`/children/${randomUUID()}`);
    expect(other.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect({ ...other.body.error, requestId: 'x' }).toEqual({ ...unknown.body.error, requestId: 'x' });
    expect(
      await prisma.auditLog.count({
        where: { action: 'parent_child.access_denied', entityId: theirs.childId, outcome: 'DENIED' },
      }),
    ).toBe(1);
    expect((await parentApi(token).get('/children/not-a-uuid')).status).toBe(400);
    const staffToken = staffTokens.get('asha1')!;
    expect(
      (await request(app).get('/api/v1/parent/children').set('Authorization', `Bearer ${staffToken}`)).status,
    ).toBe(401);
    expect((await request(app).get('/api/v1/parent/children')).status).toBe(401);
  });

  it('only children the worker confirmed are shared (an unconfirmed sibling stays hidden)', async () => {
    const a = await child('V1', 'new');
    const sibling = await child('V1', { existingGuardianId: a.guardianId });
    const token = await activateAndSignIn(a.guardianId, [a.childId], await phoneOfGuardian(a.guardianId));
    const { children } = parentChildListResponseSchema.parse((await parentApi(token).get('/children')).body);
    expect(children.map((c) => c.childId)).toEqual([a.childId]);
    expect((await parentApi(token).get(`/children/${sibling.childId}`)).status).toBe(404);
  });
});

describe('worker sharing controls', () => {
  it('shares a sibling with an activated parent, then stops sharing it (effective at once)', async () => {
    const a = await child('V1', 'new');
    const sibling = await child('V1', { existingGuardianId: a.guardianId });
    const token = await activateAndSignIn(a.guardianId, [a.childId], await phoneOfGuardian(a.guardianId));

    const grant = await (
      await staff('asha1')
    ).post(`/guardians/${a.guardianId}/child-access`, { childIds: [sibling.childId] });
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    const status = parentPortalStatusResponseSchema.parse(grant.body).portal;
    expect(status.children.find((c) => c.childId === sibling.childId)?.access).toBe('ACTIVE');
    expect((await parentApi(token).get(`/children/${sibling.childId}`)).status).toBe(200);

    const revoke = await (
      await staff('asha1')
    ).post(`/guardians/${a.guardianId}/child-access/${sibling.childId}/revoke`, {
      reason: 'Guardian asked to stop sharing',
    });
    expect(revoke.status).toBe(200);
    expect((await parentApi(token).get(`/children/${sibling.childId}`)).status).toBe(404);
    const { children } = parentChildListResponseSchema.parse((await parentApi(token).get('/children')).body);
    expect(children.map((c) => c.childId)).toEqual([a.childId]);
    const again = await (
      await staff('asha1')
    ).post(`/guardians/${a.guardianId}/child-access/${sibling.childId}/revoke`, {
      reason: 'Again please',
    });
    expect(again.status).toBe(409);
  });

  it('refuses sharing before activation, out-of-area workers, and children not linked to the guardian', async () => {
    const a = await child('V1', 'new');
    const notActive = await (
      await staff('asha1')
    ).post(`/guardians/${a.guardianId}/child-access`, { childIds: [a.childId] });
    expect(notActive.status).toBe(409);
    expect(notActive.body.error.code).toBe('NOT_ACTIVATED');

    await activateAndSignIn(a.guardianId, [a.childId], await phoneOfGuardian(a.guardianId));
    const stranger = await child('V1', 'new');
    const notLinked = await (
      await staff('asha1')
    ).post(`/guardians/${a.guardianId}/child-access`, { childIds: [stranger.childId] });
    expect(notLinked.status).toBe(422);
    const outOfArea = await (
      await staff('asha5')
    ).post(`/guardians/${a.guardianId}/child-access`, { childIds: [a.childId] });
    expect(outOfArea.status).toBe(404);
    const outRevoke = await (
      await staff('asha5')
    ).post(`/guardians/${a.guardianId}/child-access/${a.childId}/revoke`, {
      reason: 'Not mine',
    });
    expect(outRevoke.status).toBe(404);
  });

  it('ending the guardian-child link ends portal access; a deleted child disappears', async () => {
    const a = await child('V1', 'new');
    const b = await child('V1', { existingGuardianId: a.guardianId });
    const token = await activateAndSignIn(
      a.guardianId,
      [a.childId, b.childId],
      await phoneOfGuardian(a.guardianId),
    );
    // A second guardian first (a child must keep one), then end the parent's link to child a.
    const added = await (
      await staff('asha1')
    ).post(`/children/${a.childId}/guardians`, {
      clientOperationId: randomUUID(),
      newGuardian: { fullName: 'Synthetic Second Guardian' },
      relationship: 'FATHER',
      isPrimaryContact: false,
      canGiveConsent: false,
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const ended = await (
      await staff('asha1')
    ).delete(`/children/${a.childId}/guardians/${a.linkId}`, { reason: 'Moved away' });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    expect((await parentApi(token).get(`/children/${a.childId}`)).status).toBe(404);
    const row = await prisma.guardianChildAccess.findFirstOrThrow({ where: { childGuardianId: a.linkId } });
    expect(row).toMatchObject({ status: 'REVOKED', revokeReason: 'Guardian link ended' });

    await prisma.child.update({
      where: { id: b.childId },
      data: { deletedAt: clock.now(), deletionReason: 'synthetic' },
    });
    const { children } = parentChildListResponseSchema.parse((await parentApi(token).get('/children')).body);
    expect(children).toEqual([]);
  });
});
