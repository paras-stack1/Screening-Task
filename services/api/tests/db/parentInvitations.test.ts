import { createHash, randomUUID } from 'node:crypto';
import { childDetailResponseSchema, parentPortalStatusResponseSchema } from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import {
  createMockSmsSender,
  createNoSmsSender,
  type MockSmsSender,
  type SmsSender,
} from '../../src/integrations/sms/smsSender';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { DAY, testAuthConfig } from './authFixture';
import { buildAuthzFixture, PASSWORD, TestClock, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 8 Parent Portal, stage 3: worker-side invitations and secure invitation tokens, through
 * the real HTTP API and database. Synthetic data only. World: tests/db/authzFixture.ts
 * (asha1 = V1+V2, asha2 = V2, asha5 = V5, sup1 = supervisor over B1 without guardian.invite).
 */
const PORTAL = 'https://parent.example.test';
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let sms: MockSmsSender;
let app: ReturnType<typeof createApp>;

function buildApp(options: { sms?: SmsSender; portalUrl?: string } = {}) {
  return createApp({
    auth: {
      db: prisma,
      config: testAuthConfig,
      now: clock.now,
      rateLimits: { ...DEFAULT_RATE_LIMITS, loginPerIpAndAccount: 1000, loginPerIp: 1000 },
    },
    parentPortal: { portalUrl: options.portalUrl ?? PORTAL, inviteTtlHours: 24, sms: options.sms ?? sms },
  });
}

const tokens = new Map<string, string>();
/** Moves the clock; long jumps also drop cached (15-minute) access tokens. */
function advance(ms: number) {
  clock.advance(ms);
  if (ms > 60_000) tokens.clear();
}
async function as(login: string, target = app) {
  if (!tokens.has(login)) {
    const res = await request(app).post('/api/v1/auth/login').send({ loginId: login, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login ${login}: ${res.status}`);
    tokens.set(login, res.body.accessToken as string);
  }
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tokens.get(login)!}`);
  return {
    get: (path: string) => auth(request(target).get(`/api/v1${path}`)),
    post: (path: string, body?: object) => auth(request(target).post(`/api/v1${path}`)).send(body ?? {}),
  };
}

let seq = 0;
/** 0 -> "Aa", 1 -> "Ab" ... (names may not contain digits). */
const letters = (n: number) =>
  `A${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;
const WORDS = [
  'Amber',
  'Basil',
  'Cedar',
  'Dahlia',
  'Ember',
  'Fennel',
  'Garnet',
  'Hazel',
  'Indigo',
  'Juniper',
  'Lotus',
  'Opal',
];
/** Registers a child in `areaCode` with a new guardian (phone optional); returns ids. */
async function household(login: string, areaCode: string, options: { phone?: boolean } = {}) {
  const i = seq++;
  const name = `Synthetic ${WORDS[i % WORDS.length]} ${WORDS[(i * 5 + 3) % WORDS.length]} ${letters(i)}`;
  const res = await (
    await as(login)
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: name,
    dateOfBirth: new Date(Date.UTC(2021, 0, 1) + i * 40 * DAY).toISOString().slice(0, 10),
    areaId: fx.area[areaCode]!,
    guardians: [
      {
        newGuardian: {
          fullName: `${name} Mother`,
          ...(options.phone !== false && { phone: `97${String(10_000_000 + i * 104_729).slice(0, 8)}` }),
        },
        relationship: 'MOTHER',
        isPrimaryContact: true,
        canGiveConsent: true,
      },
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const child = childDetailResponseSchema.parse(res.body).child;
  return { childId: child.id, childName: child.fullName, guardianId: child.guardians[0]!.guardianId };
}

const invite = async (login: string, guardianId: string, childIds: string[], target = app) =>
  (await as(login, target)).post(`/guardians/${guardianId}/invitations`, { guardianAgreed: true, childIds });

const lastLink = () => sms.outbox.at(-1)!.params.link!;
const tokenOf = (link: string) => link.split('#')[1]!;

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

describe('creating an invitation', () => {
  it('lets an authorized worker invite: SMS sent, only the token hash stored, children PENDING', async () => {
    const h = await household('asha1', 'V1');
    const before = sms.outbox.length;
    const res = await invite('asha1', h.guardianId, [h.childId]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { portal } = parentPortalStatusResponseSchema.parse(res.body);
    expect(portal.status).toBe('INVITATION_SENT');
    expect(portal.maskedPhone).toMatch(/^\*+\d{4}$/);
    expect(portal.latestInvitation?.smsStatus).toBe('SENT');
    expect(portal.children).toEqual([expect.objectContaining({ childId: h.childId, access: 'PENDING' })]);

    expect(sms.outbox.length).toBe(before + 1);
    const message = sms.outbox.at(-1)!;
    const link = lastLink();
    expect(link.startsWith(`${PORTAL}/invite#`)).toBe(true);
    const token = tokenOf(link);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    // No child name or health detail in the SMS; the token never leaves except in the SMS.
    expect(message.text).not.toContain(h.childName);
    expect(message.text).not.toMatch(/screen|referr|risk|result|delay/i);
    expect(JSON.stringify(res.body)).not.toContain(token);

    const row = await prisma.parentInvitation.findFirstOrThrow({ where: { guardianId: h.guardianId } });
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.status).toBe('SENT');
    expect(row.expiresAt.getTime() - clock.now().getTime()).toBe(24 * 3_600_000);
    const smsRow = await prisma.smsMessage.findFirstOrThrow({ where: { guardianId: h.guardianId } });
    expect(smsRow).toMatchObject({ status: 'SENT', provider: 'mock', templateId: 'PARENT_INVITATION' });
    expect(smsRow.maskedTo).toMatch(/^\*+\d{4}$/);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: h.guardianId, action: { startsWith: 'parent_invitation' } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'parent_invitation.created',
      'parent_invitation.sms',
    ]);
    expect(JSON.stringify(audits)).not.toContain(token);
    expect(JSON.stringify(audits)).not.toContain(row.tokenHash);
  });

  it('revokes the older open invitation when a new one is sent (old link stops being open)', async () => {
    const h = await household('asha1', 'V2');
    expect((await invite('asha1', h.guardianId, [h.childId])).status).toBe(201);
    const first = await prisma.parentInvitation.findFirstOrThrow({ where: { guardianId: h.guardianId } });
    clock.advance(60_000);
    expect((await invite('asha2', h.guardianId, [h.childId])).status).toBe(201);
    const rows = await prisma.parentInvitation.findMany({
      where: { guardianId: h.guardianId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.status)).toEqual(['REVOKED', 'SENT']);
    expect(rows[0]!.id).toBe(first.id);
    expect(rows[0]!.revokedReason).toBe('Replaced by a new invitation');
    const access = await prisma.guardianChildAccess.findMany({ where: { guardianId: h.guardianId } });
    expect(access.map((a) => a.status).sort()).toEqual(['PENDING', 'REVOKED']);
  });

  it('denies a worker outside the guardian area as not found and audits it', async () => {
    const h = await household('asha1', 'V1');
    const res = await invite('asha5', h.guardianId, [h.childId]);
    expect(res.status).toBe(404);
    expect(await prisma.parentInvitation.count({ where: { guardianId: h.guardianId } })).toBe(0);
    const denied = await prisma.auditLog.findFirst({
      where: { entityId: h.guardianId, action: 'parent_invitation.access_denied', outcome: 'DENIED' },
    });
    expect(denied).not.toBeNull();
    // Status is not visible either; unknown guardians look the same.
    expect((await (await as('asha5')).get(`/guardians/${h.guardianId}/invitations`)).status).toBe(404);
    expect((await invite('asha5', randomUUID(), [h.childId])).status).toBe(404);
  });

  it('refuses roles without guardian.invite (supervisor sees status, cannot invite)', async () => {
    const h = await household('asha1', 'V1');
    expect((await invite('sup1', h.guardianId, [h.childId])).status).toBe(403);
    const view = await (await as('sup1')).get(`/guardians/${h.guardianId}/invitations`);
    expect(view.status).toBe(200);
    const { portal } = parentPortalStatusResponseSchema.parse(view.body);
    expect(portal).toMatchObject({ status: 'NOT_INVITED', canInvite: false, blockedReason: 'NOT_ALLOWED' });
  });

  it('only accepts children linked to this guardian in the caller area', async () => {
    const h = await household('asha1', 'V1');
    const other = await household('asha1', 'V1');
    const res = await invite('asha1', h.guardianId, [h.childId, other.childId]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CHILD_NOT_LINKED');
    // A link in another district (created directly) cannot be granted by asha1 either.
    const far = await household('asha5', 'V5');
    await prisma.childGuardian.create({
      data: {
        childId: far.childId,
        guardianId: h.guardianId,
        relationship: 'MOTHER',
        createdById: fx.user.stateadmin!,
      },
    });
    expect((await invite('asha1', h.guardianId, [h.childId, far.childId])).status).toBe(422);
    // ...but the guardian's children in the caller's area are listed and can be granted.
    expect((await invite('asha1', h.guardianId, [h.childId])).status).toBe(201);
    const view = parentPortalStatusResponseSchema.parse(
      (await (await as('asha1')).get(`/guardians/${h.guardianId}/invitations`)).body,
    );
    expect(view.portal.children.map((c) => c.childId)).toEqual([h.childId]);
  });

  it('rejects unexpected fields and a missing guardian agreement (400)', async () => {
    const h = await household('asha1', 'V1');
    const api = await as('asha1');
    const path = `/guardians/${h.guardianId}/invitations`;
    expect((await api.post(path, { guardianAgreed: false, childIds: [h.childId] })).status).toBe(400);
    expect(
      (await api.post(path, { guardianAgreed: true, childIds: [h.childId], tokenHash: 'x' })).status,
    ).toBe(400);
    expect(
      (await api.post(path, { guardianAgreed: true, childIds: [h.childId], phone: '9876543210' })).status,
    ).toBe(400);
    expect((await api.post(path, { guardianAgreed: true, childIds: [] })).status).toBe(400);
  });

  it('needs a recorded mobile number', async () => {
    const h = await household('asha1', 'V1', { phone: false });
    const res = await invite('asha1', h.guardianId, [h.childId]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GUARDIAN_PHONE_MISSING');
    const view = parentPortalStatusResponseSchema.parse(
      (await (await as('asha1')).get(`/guardians/${h.guardianId}/invitations`)).body,
    );
    expect(view.portal).toMatchObject({ maskedPhone: null, canInvite: false, blockedReason: 'NO_PHONE' });
  });

  it('refuses a guardian who already has an active account (409)', async () => {
    const h = await household('asha1', 'V1');
    const g = await prisma.guardian.findUniqueOrThrow({ where: { id: h.guardianId } });
    await prisma.parentAccount.create({
      data: {
        guardianId: h.guardianId,
        phoneLookupHash: g.phoneLookupHash!,
        passwordHash: 'synthetic-not-a-real-hash',
        passwordChangedAt: clock.now(),
        privacyNoticeVersion: 'synthetic',
        termsVersion: 'synthetic',
        acceptedAt: clock.now(),
        activatedAt: clock.now(),
      },
    });
    const res = await invite('asha1', h.guardianId, [h.childId]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_ACTIVATED');
  });

  it('limits invitations per guardian per day (429)', async () => {
    const h = await household('asha1', 'V1');
    for (let i = 0; i < 3; i++) {
      expect((await invite('asha1', h.guardianId, [h.childId])).status).toBe(201);
      clock.advance(1000);
    }
    const res = await invite('asha1', h.guardianId, [h.childId]);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('INVITATION_LIMIT');
    advance(DAY);
    expect((await invite('asha1', h.guardianId, [h.childId])).status).toBe(201);
  });
});

describe('without an SMS provider or portal address', () => {
  it('keeps the invitation PENDING with NOT_CONFIGURED and never claims it was sent', async () => {
    const h = await household('asha1', 'V1');
    const before = sms.outbox.length;
    const res = await invite('asha1', h.guardianId, [h.childId], buildApp({ sms: createNoSmsSender() }));
    expect(res.status).toBe(201);
    const { portal } = parentPortalStatusResponseSchema.parse(res.body);
    expect(portal.status).toBe('INVITATION_PENDING');
    expect(portal.latestInvitation).toMatchObject({ sentAt: null, smsStatus: 'NOT_CONFIGURED' });
    expect(sms.outbox.length).toBe(before);
    const row = await prisma.parentInvitation.findFirstOrThrow({ where: { guardianId: h.guardianId } });
    expect(row).toMatchObject({ status: 'PENDING', sentAt: null });
  });

  it('records a failing provider as FAILED (invitation kept, PENDING)', async () => {
    const h = await household('asha1', 'V1');
    const broken: SmsSender = {
      provider: 'broken',
      configured: true,
      send: () => Promise.reject(new Error('down')),
    };
    const res = await invite('asha1', h.guardianId, [h.childId], buildApp({ sms: broken }));
    expect(res.status).toBe(201);
    expect(parentPortalStatusResponseSchema.parse(res.body).portal.latestInvitation?.smsStatus).toBe(
      'FAILED',
    );
  });

  it('refuses invitations until the trusted portal address is configured (503)', async () => {
    const h = await household('asha1', 'V1');
    const res = await invite('asha1', h.guardianId, [h.childId], buildApp({ portalUrl: '' }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PARENT_PORTAL_NOT_CONFIGURED');
    expect(await prisma.parentInvitation.count({ where: { guardianId: h.guardianId } })).toBe(0);
  });
});

describe('status, expiry and revocation', () => {
  it('reports EXPIRED after the lifetime', async () => {
    const h = await household('asha1', 'V1');
    await invite('asha1', h.guardianId, [h.childId]);
    advance(24 * 3_600_000 + 1000);
    const view = parentPortalStatusResponseSchema.parse(
      (await (await as('asha1')).get(`/guardians/${h.guardianId}/invitations`)).body,
    );
    expect(view.portal.status).toBe('EXPIRED');
    expect(view.portal.canInvite).toBe(true);
  });

  it('lets an authorized worker revoke; the pending child access is revoked too', async () => {
    const h = await household('asha1', 'V1');
    const created = parentPortalStatusResponseSchema.parse(
      (await invite('asha1', h.guardianId, [h.childId])).body,
    );
    const id = created.portal.latestInvitation!.id;
    const api = await as('asha1');
    expect(
      (
        await (
          await as('asha5')
        ).post(`/guardians/${h.guardianId}/invitations/${id}/revoke`, { reason: 'Wrong number' })
      ).status,
    ).toBe(404);
    const res = await api.post(`/guardians/${h.guardianId}/invitations/${id}/revoke`, {
      reason: 'Wrong number',
    });
    expect(res.status).toBe(200);
    const { portal } = parentPortalStatusResponseSchema.parse(res.body);
    expect(portal.status).toBe('REVOKED');
    expect(portal.children[0]!.access).toBe('REVOKED');
    expect(
      (await api.post(`/guardians/${h.guardianId}/invitations/${id}/revoke`, { reason: 'Again please' }))
        .status,
    ).toBe(409);
  });
});

describe('database rules', () => {
  it('allows only one open invitation per guardian and keeps the token hash immutable', async () => {
    const h = await household('asha1', 'V1');
    await invite('asha1', h.guardianId, [h.childId]);
    const row = await prisma.parentInvitation.findFirstOrThrow({ where: { guardianId: h.guardianId } });
    await expect(
      prisma.parentInvitation.create({
        data: {
          guardianId: h.guardianId,
          tokenHash: 'f'.repeat(64),
          expiresAt: row.expiresAt,
          phoneLookupHash: row.phoneLookupHash,
          createdById: fx.user.asha1!,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.parentInvitation.update({ where: { id: row.id }, data: { tokenHash: 'e'.repeat(64) } }),
    ).rejects.toThrow();
    await expect(prisma.parentInvitation.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});
