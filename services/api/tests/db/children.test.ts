import { randomUUID } from 'node:crypto';
import {
  childDetailResponseSchema,
  childListResponseSchema,
  duplicateChildDetailsSchema,
  duplicateGuardianDetailsSchema,
  guardianDetailResponseSchema,
  guardianLinkListResponseSchema,
  registrationAreasResponseSchema,
} from '@balswasthya/shared-contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { hashPassword } from '../../src/utils/password';
import { DAY, testAuthConfig } from './authFixture';
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
 * Step 5, stage 5B: child registration, guardians and child-guardian links through the real HTTP
 * API and database. Synthetic data only. World: tests/db/authzFixture.ts (asha1 = V1+V2,
 * asha2 = V2, asha5 = V5, sup1 = supervisor B1 subtree without child.create, dadmin1 = no
 * child access) plus "mo1", a medical officer over the whole B1 subtree.
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createTestApp>;
const tokens = new Map<string, string>();

async function as(login: string) {
  if (!tokens.has(login)) tokens.set(login, await tokenFor(app, login));
  return api(app, tokens.get(login)!);
}

// Distinct synthetic names/dates per test so duplicate checks never cross between tests.
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
  'Kestrel',
  'Lotus',
  'Marigold',
  'Nectar',
  'Opal',
  'Pepper',
  'Quartz',
  'Rowan',
  'Saffron',
  'Tamarind',
  'Umber',
  'Violet',
  'Willow',
  'Yarrow',
  'Zinnia',
  'Acacia',
  'Bramble',
  'Clover',
  'Dune',
  'Elder',
];
let seq = 0;
function uniqueChild() {
  const i = seq++;
  const dob = new Date(Date.UTC(2010, 0, 1) + i * 75 * DAY).toISOString().slice(0, 10);
  return { name: `Synthetic ${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]}`, dob };
}
let phoneSeq = 0;
const uniquePhone = () => `98${String(10_000_000 + ((phoneSeq++ * 7919) % 89_999_999)).padStart(8, '0')}`;

function registration(areaCode: string, overrides: Record<string, unknown> = {}) {
  const c = uniqueChild();
  return {
    clientOperationId: randomUUID(),
    fullName: c.name,
    dateOfBirth: c.dob,
    areaId: fx.area[areaCode]!,
    guardians: [
      {
        newGuardian: { fullName: `${c.name} Mother`, phone: uniquePhone() },
        relationship: 'MOTHER',
        isPrimaryContact: true,
        canGiveConsent: true,
      },
    ],
    ...overrides,
  };
}

async function register(login: string, body: object) {
  return (await as(login)).post('/children', body);
}

async function registered(login: string, body: object) {
  const res = await register(login, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return childDetailResponseSchema.parse(res.body).child;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  app = createTestApp(prisma, clock);
  fx = await buildAuthzFixture(prisma, clock);

  // A medical officer over the B1 subtree (child.create over several villages and a sector).
  const mo = await prisma.user.create({
    data: {
      loginId: 'MO1',
      displayName: 'Synthetic mo1',
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: false,
    },
  });
  await prisma.workerAreaAssignment.create({
    data: {
      userId: mo.id,
      roleId: fx.role.MHT_MEDICAL_OFFICER!,
      areaId: fx.area.B1!,
      scope: 'AREA_AND_DESCENDANTS',
      effectiveFrom: new Date(clock.now().getTime() - 30 * DAY),
      createdById: fx.user.stateadmin!,
    },
  });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

// ======================================================================= registration

describe('child registration', () => {
  it('registers a child with a new guardian; server sets creator, timestamps and defaults', async () => {
    const body = registration('V1');
    const res = await register('asha1', body);
    expect(res.status).toBe(201);
    const child = childDetailResponseSchema.parse(res.body).child;
    expect(child).toMatchObject({
      fullName: body.fullName,
      dateOfBirth: body.dateOfBirth,
      dobIsEstimated: false,
      sexAtBirth: 'NOT_RECORDED',
      areaId: fx.area.V1,
      registeredAt: clock.now().toISOString(),
      registeredByName: 'Synthetic asha1',
    });
    expect(child.guardians).toHaveLength(1);
    expect(child.guardians[0]).toMatchObject({
      relationship: 'MOTHER',
      isPrimaryContact: true,
      canGiveConsent: true,
    });
    expect(child.guardians[0]!.phoneMasked).toMatch(/^\+91 ••••••\d{4}$/);

    const row = await prisma.child.findUniqueOrThrow({ where: { id: child.id } });
    expect(row.createdById).toBe(fx.user.asha1);

    // Phone stored encrypted + keyed hash, never in plain text.
    const phone = body.guardians[0]!.newGuardian.phone;
    const guardian = await prisma.guardian.findUniqueOrThrow({
      where: { id: child.guardians[0]!.guardianId },
    });
    expect(guardian.phoneEncrypted).not.toBeNull();
    expect(Buffer.from(guardian.phoneEncrypted!).toString('latin1')).not.toContain(phone.slice(-6));
    expect(guardian.phoneLookupHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(res.body)).not.toContain(phone.slice(-6));
  });

  it('writes child, guardian and link audit events with no names or phone numbers', async () => {
    const body = registration('V1');
    const res = await register('asha1', body);
    const requestId = res.headers['x-request-id'] as string;
    const events = await prisma.auditLog.findMany({ where: { requestId }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.action).sort()).toEqual(
      ['child.registered', 'child_guardian.linked', 'guardian.created'].sort(),
    );
    expect(events.every((e) => e.actorUserId === fx.user.asha1 && e.outcome === 'SUCCESS')).toBe(true);
    const text = JSON.stringify(events);
    expect(text).not.toContain(body.fullName);
    expect(text).not.toContain(body.guardians[0]!.newGuardian.phone.slice(-6));
  });

  it('records an estimated date of birth explicitly', async () => {
    const { dateOfBirth: _omit, ...rest } = registration('V1');
    const child = await registered('asha1', { ...rest, ageEstimate: { years: 4, months: 2 } });
    expect(child.dobIsEstimated).toBe(true);
    expect(child.dateOfBirth).toBe('2022-09-21'); // test clock: 2026-11-21 (India)
  });

  it.each([
    ['future date of birth', { dateOfBirth: '2026-11-22' }, 422, 'DATE_OF_BIRTH_IN_FUTURE'],
    ['impossible date', { dateOfBirth: '2023-02-29' }, 422, 'INVALID_DATE_OF_BIRTH'],
    ['too old for the programme', { dateOfBirth: '2005-01-01' }, 422, 'CHILD_AGE_OUT_OF_RANGE'],
    ['missing name', { fullName: '' }, 400, 'VALIDATION_ERROR'],
    [
      'client-supplied creator',
      { createdById: '00000000-0000-4000-8000-000000000001' },
      400,
      'VALIDATION_ERROR',
    ],
    ['client-supplied timestamp', { createdAt: '2020-01-01T00:00:00Z' }, 400, 'VALIDATION_ERROR'],
    ['malformed area id', { areaId: "x' OR '1'='1" }, 400, 'VALIDATION_ERROR'],
  ])('rejects %s', async (_name, override, status, code) => {
    const before = await prisma.child.count();
    const res = await register('asha1', registration('V1', override));
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(await prisma.child.count()).toBe(before);
  });

  it('refuses areas outside the worker scope, unknown areas and non-registration levels alike (403, audited)', async () => {
    for (const areaId of [fx.area.V5!, randomUUID(), fx.area.S1!]) {
      const res = await register('mo1', registration('V1', { areaId }));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AREA_NOT_ALLOWED');
    }
    const denied = await prisma.auditLog.count({
      where: {
        action: 'child.registration_denied',
        actorUserId: (await prisma.user.findUniqueOrThrow({ where: { loginId: 'MO1' } })).id,
      },
    });
    expect(denied).toBe(3);
    // The same worker may register in a village of the subtree.
    await registered('mo1', registration('V3'));
  });

  it('a supervisor without child.create cannot register (403)', async () => {
    const res = await register('sup1', registration('V1'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('registration areas: only active registration-level areas in child.create scope', async () => {
    const res = await (await as('mo1')).get('/children/registration-areas');
    expect(res.status).toBe(200);
    const names = registrationAreasResponseSchema
      .parse(res.body)
      .items.map((a) => a.nameEn)
      .sort();
    expect(names).toEqual(['Area AWC1', 'Area V1', 'Area V2', 'Area V3']);
    const asha = registrationAreasResponseSchema.parse(
      (await (await as('asha1')).get('/children/registration-areas')).body,
    );
    expect(asha.items.map((a) => a.nameEn).sort()).toEqual(['Area V1', 'Area V2']);
    expect((await (await as('dadmin1')).get('/children/registration-areas')).status).toBe(403);
    expect((await (await as('sup1')).get('/children/registration-areas')).status).toBe(403);
  });
});

// ======================================================================= duplicates

describe('duplicate prevention (never merges, never leaks)', () => {
  it('warns about a similar in-scope child, and registers both after confirmation', async () => {
    const first = registration('V1');
    const original = await registered('asha1', first);
    const near = new Date(Date.parse(first.dateOfBirth) + 3 * DAY).toISOString().slice(0, 10);
    const second = registration('V1', { fullName: first.fullName.replace(/.$/, 'x'), dateOfBirth: near });

    const res = await register('asha1', second);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POSSIBLE_DUPLICATE');
    const details = duplicateChildDetailsSchema.parse(res.body.error.details);
    expect(details.candidates).toEqual([
      expect.objectContaining({ id: original.id, reasons: ['SIMILAR_NAME_AND_BIRTH'] }),
    ]);
    const warning = await prisma.auditLog.findFirst({
      where: { action: 'child.duplicate_warning', requestId: res.headers['x-request-id'] as string },
    });
    expect(warning?.details).toEqual({ candidateIds: [original.id] });

    const confirmed = await registered('asha1', { ...second, confirmNotDuplicate: true });
    expect(confirmed.id).not.toBe(original.id);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'child.registered', entityId: confirmed.id },
    });
    expect(audit.details).toMatchObject({ duplicateOverride: true, candidateIds: [original.id] });
    expect(await prisma.child.count({ where: { id: { in: [original.id, confirmed.id] } } })).toBe(2);
  });

  it('never reveals a matching child in another area (no warning, no data)', async () => {
    const secret = registration('V5');
    const phone = secret.guardians[0]!.newGuardian.phone;
    await registered('asha5', secret);

    const same = registration('V1', { fullName: secret.fullName, dateOfBirth: secret.dateOfBirth });
    same.guardians[0]!.newGuardian.phone = phone; // same household phone too
    const res = await register('asha1', same);
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain(fx.area.V5!);
  });

  it('flags a sibling born within a month of an existing child of the same guardian (possible twin)', async () => {
    const elder = await registered('asha1', registration('V1'));
    const guardianId = elder.guardians[0]!.guardianId;
    const twin = registration('V1', { dateOfBirth: elder.dateOfBirth });
    twin.guardians = [
      { existingGuardianId: guardianId, relationship: 'MOTHER', canGiveConsent: true },
    ] as never;
    const res = await register('asha1', twin);
    expect(res.status).toBe(409);
    expect(duplicateChildDetailsSchema.parse(res.body.error.details).candidates[0]).toMatchObject({
      id: elder.id,
      reasons: ['SHARED_GUARDIAN'],
    });
    const created = await registered('asha1', { ...twin, confirmNotDuplicate: true });
    expect(created.guardians[0]!.guardianId).toBe(guardianId); // shared guardian, not a copy
  });

  it('warns before creating a second guardian with an in-scope phone number (masked only)', async () => {
    const first = registration('V1');
    const phone = first.guardians[0]!.newGuardian.phone;
    const existing = await registered('asha1', first);
    const second = registration('V2');
    second.guardians[0]!.newGuardian.phone = ` +91 ${phone.slice(0, 5)} ${phone.slice(5)} `;

    const res = await register('asha1', second);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POSSIBLE_DUPLICATE_GUARDIAN');
    const details = duplicateGuardianDetailsSchema.parse(res.body.error.details);
    expect(details.guardianIndex).toBe(0);
    expect(details.candidates).toEqual([
      {
        guardianId: existing.guardians[0]!.guardianId,
        fullName: expect.any(String),
        phoneMasked: `+91 ••••••${phone.slice(-4)}`,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(phone.slice(0, 6));

    second.guardians[0] = { ...second.guardians[0]!, confirmNewGuardian: true } as never;
    await registered('asha1', second);
  });

  it('two simultaneous registrations of the same child: exactly one succeeds, the other is warned', async () => {
    const body = registration('V2');
    const [a, b] = await Promise.all([
      register('asha2', { ...body, clientOperationId: randomUUID() }),
      register('asha2', {
        ...body,
        clientOperationId: randomUUID(),
        guardians: [
          { ...body.guardians[0], newGuardian: { ...body.guardians[0]!.newGuardian, phone: uniquePhone() } },
        ],
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.child.count({ where: { fullName: body.fullName } })).toBe(1);
  });
});

// ======================================================================= idempotency + atomicity

describe('safe retries and all-or-nothing writes', () => {
  it('a retried submission returns the first result and creates nothing new', async () => {
    const body = registration('V1');
    const first = await registered('asha1', body);
    const retry = await register('asha1', body);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.body.child.id).toBe(first.id);
    expect(await prisma.child.count({ where: { fullName: body.fullName } })).toBe(1);
  });

  it('the same submission id with different content is refused', async () => {
    const body = registration('V1');
    await registered('asha1', body);
    const res = await register('asha1', { ...body, fullName: 'Synthetic Different Person' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a double tap (same id, simultaneous) creates one child', async () => {
    const body = registration('V1');
    const [a, b] = await Promise.all([register('asha1', body), register('asha1', body)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.child.id).toBe(b.body.child.id);
    expect(await prisma.child.count({ where: { fullName: body.fullName } })).toBe(1);
  });

  it('an out-of-scope existing guardian fails the whole registration (nothing written, denial audited)', async () => {
    const before = { children: await prisma.child.count(), guardians: await prisma.guardian.count() };
    const body = registration('V1');
    body.guardians.push({
      existingGuardianId: fx.linked.C6.guardian,
      relationship: 'FATHER',
      canGiveConsent: false,
    } as never);
    const res = await register('asha1', body);
    expect(res.status).toBe(404);
    expect({ children: await prisma.child.count(), guardians: await prisma.guardian.count() }).toEqual(
      before,
    );
    const denial = await prisma.auditLog.findFirst({
      where: { action: 'guardian.access_denied', requestId: res.headers['x-request-id'] as string },
    });
    expect(denial?.outcome).toBe('DENIED');
    // The failed attempt can be retried with the same submission id after correction.
    body.guardians.pop();
    await registered('asha1', body);
  });
});

// ======================================================================= profile + update

describe('child profile and updates', () => {
  it('profile: masked phone, registration details; another area gets 404 (audited)', async () => {
    const child = await registered('asha1', registration('V1'));
    const res = await (await as('asha1')).get(`/children/${child.id}`);
    expect(res.status).toBe(200);
    expect(res.body.child.guardians[0].phoneMasked).toMatch(/^\+91 ••••••\d{4}$/);
    expect(res.body.child).not.toHaveProperty('createdById');

    const denied = await (await as('asha5')).get(`/children/${child.id}`);
    expect(denied.status).toBe(404);
    expect(denied.body.error.message).toBe('Child not found');
  });

  it('updates name with the current version; field names only in the audit', async () => {
    const child = await registered('asha1', registration('V1'));
    const res = await (
      await as('asha1')
    ).patch(`/children/${child.id}`, {
      expectedUpdatedAt: child.updatedAt,
      fullName: 'Synthetic Renamed Child',
      sexAtBirth: 'FEMALE',
    });
    expect(res.status).toBe(200);
    expect(res.body.child).toMatchObject({ fullName: 'Synthetic Renamed Child', sexAtBirth: 'FEMALE' });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'child.updated', entityId: child.id },
    });
    expect(audit.details).toEqual({ fields: ['fullName', 'sexAtBirth'] });
  });

  it('a stale version is refused instead of overwriting another worker change (409)', async () => {
    const child = await registered('asha1', registration('V1'));
    const ok = await (
      await as('asha1')
    ).patch(`/children/${child.id}`, {
      expectedUpdatedAt: child.updatedAt,
      sexAtBirth: 'MALE',
    });
    expect(ok.status).toBe(200);
    const stale = await (
      await as('asha1')
    ).patch(`/children/${child.id}`, {
      expectedUpdatedAt: child.updatedAt,
      fullName: 'Synthetic Lost Update',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_RECORD');
  });

  it.each([
    ['area change', { areaId: '00000000-0000-4000-8000-000000000001' }, 400],
    ['creator change', { createdById: '00000000-0000-4000-8000-000000000001' }, 400],
    ['soft-delete flag', { deletedAt: '2026-01-01T00:00:00Z' }, 400],
    ['future date of birth', { dateOfBirth: '2030-01-01' }, 422],
  ])('refuses %s', async (_name, extra, status) => {
    const child = await registered('asha1', registration('V1'));
    const res = await (
      await as('asha1')
    ).patch(`/children/${child.id}`, { expectedUpdatedAt: child.updatedAt, ...extra });
    expect(res.status).toBe(status);
    const row = await prisma.child.findUniqueOrThrow({ where: { id: child.id } });
    expect(row.areaId).toBe(fx.area.V1);
  });

  it('out-of-scope update -> 404; supervisor (read-only) -> 403', async () => {
    const child = await registered('asha1', registration('V1'));
    const body = { expectedUpdatedAt: child.updatedAt, fullName: 'Synthetic Hijack' };
    expect((await (await as('asha5')).patch(`/children/${child.id}`, body)).status).toBe(404);
    expect((await (await as('sup1')).patch(`/children/${child.id}`, body)).status).toBe(403);
  });

  it('list filters by registration date (India calendar day) within scope only', async () => {
    clock.advance(10 * DAY);
    tokens.clear(); // cached access tokens (15 min) expire with the jump; sign in again

    const child = await registered('asha1', registration('V1'));
    const day = new Date(clock.now().getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const res = await (await as('asha1')).get(`/children?registeredFrom=${day}&registeredTo=${day}`);
    expect(res.status).toBe(200);
    expect(childListResponseSchema.parse(res.body).items.map((c) => c.id)).toEqual([child.id]);
    expect((await (await as('asha5')).get(`/children?registeredFrom=${day}`)).body.total).toBe(0);
    expect((await (await as('asha1')).get('/children?registeredFrom=2026-02-30')).status).toBe(422);
  });
});

// ======================================================================= guardians

describe('guardians', () => {
  it('guardian view shows the full phone to an authorised worker (audited) and 404 elsewhere', async () => {
    const body = registration('V1');
    const child = await registered('asha1', body);
    const guardianId = child.guardians[0]!.guardianId;
    const res = await (await as('asha1')).get(`/guardians/${guardianId}`);
    expect(res.status).toBe(200);
    const guardian = guardianDetailResponseSchema.parse(res.body).guardian;
    expect(guardian.phone).toBe(`+91${body.guardians[0]!.newGuardian.phone}`);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'guardian.viewed', entityId: guardianId },
    });
    expect(audit.details).toEqual({ phoneRevealed: true });
    expect((await (await as('asha5')).get(`/guardians/${guardianId}`)).status).toBe(404);
  });

  it('scenario 4: a shared guardian never reveals the other area child', async () => {
    const own = await registered('asha1', registration('V1'));
    const guardianId = own.guardians[0]!.guardianId;
    // The same person is also guardian of a child in V5 (linked directly - no worker has both).
    const other = await prisma.child.create({
      data: {
        areaId: fx.area.V5!,
        fullName: 'Synthetic Hidden Sibling',
        dateOfBirth: new Date('2016-06-06'),
        sexAtBirth: 'MALE',
        createdById: fx.user.stateadmin!,
      },
    });
    await prisma.childGuardian.create({ data: { childId: other.id, guardianId, relationship: 'MOTHER' } });

    const res = await (await as('asha1')).get(`/guardians/${guardianId}`);
    expect(guardianDetailResponseSchema.parse(res.body).guardian.children.map((c) => c.childId)).toEqual([
      own.id,
    ]);
    expect(JSON.stringify(res.body)).not.toContain(other.id);
    expect(JSON.stringify(res.body)).not.toContain('Hidden Sibling');
    // asha2 (V2 only) cannot reach the guardian at all.
    expect((await (await as('asha2')).get(`/guardians/${guardianId}`)).status).toBe(404);
    // The V5 worker sees the guardian but only the V5 child.
    const v5 = await (await as('asha5')).get(`/guardians/${guardianId}`);
    expect(guardianDetailResponseSchema.parse(v5.body).guardian.children.map((c) => c.childId)).toEqual([
      other.id,
    ]);
  });

  it('updates phone and language with optimistic concurrency; removal clears ciphertext and hash', async () => {
    const child = await registered('asha1', registration('V1'));
    const guardianId = child.guardians[0]!.guardianId;
    const g = guardianDetailResponseSchema.parse(
      (await (await as('asha1')).get(`/guardians/${guardianId}`)).body,
    ).guardian;
    const newPhone = uniquePhone();
    const res = await (
      await as('asha1')
    ).patch(`/guardians/${guardianId}`, {
      expectedUpdatedAt: g.updatedAt,
      phone: newPhone,
      preferredLanguage: 'en',
    });
    expect(res.status).toBe(200);
    expect(res.body.guardian).toMatchObject({ phone: `+91${newPhone}`, preferredLanguage: 'en' });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'guardian.updated', entityId: guardianId },
    });
    expect(audit.details).toEqual({ fields: ['preferredLanguage', 'phone'] });
    expect(JSON.stringify(audit)).not.toContain(newPhone.slice(-6));

    const stale = await (
      await as('asha1')
    ).patch(`/guardians/${guardianId}`, { expectedUpdatedAt: g.updatedAt, phone: null });
    expect(stale.status).toBe(409);
    const removed = await (
      await as('asha1')
    ).patch(`/guardians/${guardianId}`, {
      expectedUpdatedAt: res.body.guardian.updatedAt,
      phone: null,
    });
    expect(removed.body.guardian.phone).toBeNull();
    const row = await prisma.guardian.findUniqueOrThrow({ where: { id: guardianId } });
    expect([row.phoneEncrypted, row.phoneLookupHash]).toEqual([null, null]);
  });

  it('guardian update outside scope -> 404; a protected field -> 400', async () => {
    const child = await registered('asha1', registration('V1'));
    const guardianId = child.guardians[0]!.guardianId;
    const g = (await (await as('asha1')).get(`/guardians/${guardianId}`)).body.guardian;
    expect(
      (
        await (
          await as('asha5')
        ).patch(`/guardians/${guardianId}`, { expectedUpdatedAt: g.updatedAt, fullName: 'Synthetic X' })
      ).status,
    ).toBe(404);
    expect(
      (
        await (
          await as('asha1')
        ).patch(`/guardians/${guardianId}`, { expectedUpdatedAt: g.updatedAt, deletedAt: null })
      ).status,
    ).toBe(400);
  });
});

// ======================================================================= links

describe('child-guardian links', () => {
  async function childWithGuardian() {
    return registered('asha1', registration('V1'));
  }

  it('links a sibling guardian; a second active link of the same pair is refused', async () => {
    const elder = await childWithGuardian();
    const younger = await childWithGuardian();
    const guardianId = elder.guardians[0]!.guardianId;
    const body = {
      clientOperationId: randomUUID(),
      existingGuardianId: guardianId,
      relationship: 'MOTHER',
      canGiveConsent: true,
    };
    const res = await (await as('asha1')).post(`/children/${younger.id}/guardians`, body);
    expect(res.status).toBe(201);
    expect(res.body.link).toMatchObject({ guardianId, relationship: 'MOTHER', isPrimaryContact: false });

    const again = await (
      await as('asha1')
    ).post(`/children/${younger.id}/guardians`, { ...body, clientOperationId: randomUUID() });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('GUARDIAN_ALREADY_LINKED');
  });

  it('cross-area linking is refused: out-of-scope guardian (404) and out-of-scope child (404)', async () => {
    const child = await childWithGuardian();
    const linkOther = await (
      await as('asha1')
    ).post(`/children/${child.id}/guardians`, {
      clientOperationId: randomUUID(),
      existingGuardianId: fx.linked.C6.guardian,
      relationship: 'FATHER',
      canGiveConsent: false,
    });
    expect(linkOther.status).toBe(404);
    const toOtherChild = await (
      await as('asha1')
    ).post(`/children/${fx.child.C6}/guardians`, {
      clientOperationId: randomUUID(),
      existingGuardianId: child.guardians[0]!.guardianId,
      relationship: 'FATHER',
      canGiveConsent: false,
    });
    expect(toOtherChild.status).toBe(404);
    expect(await prisma.childGuardian.count({ where: { childId: fx.child.C6!, endedAt: null } })).toBe(1);
  });

  it('only one primary contact: choosing a new one clears the previous (audited)', async () => {
    const child = await childWithGuardian();
    const res = await (
      await as('asha1')
    ).post(`/children/${child.id}/guardians`, {
      clientOperationId: randomUUID(),
      newGuardian: { fullName: 'Synthetic Second Guardian' },
      relationship: 'FATHER',
      isPrimaryContact: true,
      canGiveConsent: false,
    });
    expect(res.status).toBe(201);
    const links = guardianLinkListResponseSchema.parse(
      (await (await as('asha1')).get(`/children/${child.id}/guardians`)).body,
    ).items;
    expect(links.filter((l) => l.isPrimaryContact).map((l) => l.relationship)).toEqual(['FATHER']);
    const cleared = await prisma.auditLog.findFirst({
      where: { action: 'child_guardian.updated', entityId: child.guardians[0]!.relationshipId },
    });
    expect(cleared?.details).toMatchObject({ changes: { isPrimaryContact: { from: true, to: false } } });
  });

  it('updates consent authority of a link (audited with before/after)', async () => {
    const child = await childWithGuardian();
    const linkId = child.guardians[0]!.relationshipId;
    const res = await (
      await as('asha1')
    ).patch(`/children/${child.id}/guardians/${linkId}`, {
      canGiveConsent: false,
      relationship: 'LEGAL_GUARDIAN',
    });
    expect(res.status).toBe(200);
    expect(res.body.link).toMatchObject({ canGiveConsent: false, relationship: 'LEGAL_GUARDIAN' });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'child_guardian.updated', entityId: linkId },
    });
    expect(audit.details).toMatchObject({
      changes: {
        canGiveConsent: { from: true, to: false },
        relationship: { from: 'MOTHER', to: 'LEGAL_GUARDIAN' },
      },
    });
  });

  it('scenario 5 / nested IDOR: a link id of another child is refused (404, audited)', async () => {
    const child = await childWithGuardian();
    const foreignLink = await prisma.childGuardian.findFirstOrThrow({ where: { childId: fx.child.C6! } });
    const res = await (
      await as('asha1')
    ).patch(`/children/${child.id}/guardians/${foreignLink.id}`, { canGiveConsent: true });
    expect(res.status).toBe(404);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'childGuardian.access_denied', requestId: res.headers['x-request-id'] as string },
    });
    expect(audit?.details).toMatchObject({ recordExists: true });
    expect(
      (await prisma.childGuardian.findUniqueOrThrow({ where: { id: foreignLink.id } })).canGiveConsent,
    ).toBe(true);
    // And through the other child's URL: the child itself is out of scope.
    const viaOther = await (
      await as('asha1')
    ).delete(`/children/${fx.child.C6}/guardians/${foreignLink.id}`, { reason: 'Synthetic test' });
    expect(viaOther.status).toBe(404);
  });

  it('ending a link keeps history; the last guardian cannot be removed; re-linking creates a new row', async () => {
    const child = await childWithGuardian();
    const first = child.guardians[0]!;
    const noReason = await (
      await as('asha1')
    ).delete(`/children/${child.id}/guardians/${first.relationshipId}`);
    expect(noReason.status).toBe(400);
    const last = await (
      await as('asha1')
    ).delete(`/children/${child.id}/guardians/${first.relationshipId}`, { reason: 'Recorded by mistake' });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('LAST_GUARDIAN');

    await (
      await as('asha1')
    ).post(`/children/${child.id}/guardians`, {
      clientOperationId: randomUUID(),
      newGuardian: { fullName: 'Synthetic Correct Guardian' },
      relationship: 'GRANDPARENT',
      canGiveConsent: false,
    });
    const ended = await (
      await as('asha1')
    ).delete(`/children/${child.id}/guardians/${first.relationshipId}`, { reason: 'Recorded by mistake' });
    expect(ended.status).toBe(200);
    expect(ended.body.link.endedAt).toBe(clock.now().toISOString());
    const endAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'child_guardian.ended', entityId: first.relationshipId },
    });
    expect(JSON.stringify(endAudit.details)).not.toContain('mistake'); // free text never copied

    const current = (await (await as('asha1')).get(`/children/${child.id}/guardians`)).body.items;
    expect(
      guardianLinkListResponseSchema.parse({ items: current }).items.map((l) => l.relationshipId),
    ).not.toContain(first.relationshipId);
    const all = (await (await as('asha1')).get(`/children/${child.id}/guardians?includeEnded=true`)).body
      .items;
    expect(all).toHaveLength(2);

    const relinked = await (
      await as('asha1')
    ).post(`/children/${child.id}/guardians`, {
      clientOperationId: randomUUID(),
      existingGuardianId: first.guardianId,
      relationship: 'MOTHER',
      canGiveConsent: true,
    });
    expect(relinked.status).toBe(201);
    expect(relinked.body.link.relationshipId).not.toBe(first.relationshipId);
    expect(
      await prisma.childGuardian.count({ where: { childId: child.id, guardianId: first.guardianId } }),
    ).toBe(2);
  });

  it('the database itself refuses a second active link and a second primary contact', async () => {
    const child = await childWithGuardian();
    const guardianId = child.guardians[0]!.guardianId;
    await expect(
      prisma.childGuardian.create({ data: { childId: child.id, guardianId, relationship: 'MOTHER' } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const other = await prisma.guardian.create({ data: { fullName: 'Synthetic Other' } });
    await expect(
      prisma.childGuardian.create({
        data: { childId: child.id, guardianId: other.id, relationship: 'FATHER', isPrimaryContact: true },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

// ======================================================================= consent table integrity

describe('consent history is append-only at database level (decision B)', () => {
  it('rejects deleting or rewriting a consent; allows one withdrawal of a granted record', async () => {
    const consentId = fx.linked.C1.consent;
    await expect(prisma.consent.delete({ where: { id: consentId } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.consent.update({ where: { id: consentId }, data: { decision: 'REFUSED' } }),
    ).rejects.toThrow(/only be changed by withdrawal/);
    await expect(
      prisma.consent.update({
        where: { id: consentId },
        data: { withdrawnAt: clock.now(), withdrawnById: fx.user.asha1!, purpose: 'SCREENING' },
      }),
    ).rejects.toThrow(/immutable/);
    await prisma.consent.update({
      where: { id: consentId },
      data: { withdrawnAt: clock.now(), withdrawnById: fx.user.asha1!, withdrawalMethod: 'SIGNATURE' },
    });
    await expect(
      prisma.consent.update({ where: { id: consentId }, data: { withdrawalReason: 'changed' } }),
    ).rejects.toThrow(/already withdrawn/);
  });
});

// ======================================================================= rate limits

describe('per-user rate limit on child data (decision Q)', () => {
  it('limits reads per user, independently for each user', async () => {
    const limited = createApp({
      auth: {
        db: prisma,
        config: testAuthConfig,
        now: clock.now,
        rateLimits: {
          ...DEFAULT_RATE_LIMITS,
          loginPerIp: 1000,
          loginPerIpAndAccount: 1000,
          childDataReadPerUser: 3,
        },
      },
    });
    const login = async (id: string) =>
      (await request(limited).post('/api/v1/auth/login').send({ loginId: id, password: PASSWORD })).body
        .accessToken as string;
    const t1 = await login('ASHA1');
    const t2 = await login('ASHA2');
    const get = (t: string) => request(limited).get('/api/v1/children').set('Authorization', `Bearer ${t}`);
    for (let i = 0; i < 3; i += 1) expect((await get(t1)).status).toBe(200);
    const blocked = await get(t1);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect((await get(t2)).status).toBe(200);
  });
});
