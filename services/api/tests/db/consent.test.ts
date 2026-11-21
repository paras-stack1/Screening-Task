import { randomUUID } from 'node:crypto';
import {
  childConsentsResponseSchema,
  childDetailResponseSchema,
  consentNoticesResponseSchema,
  consentRecordResponseSchema,
  type ConsentPurpose,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { ensureConsentTemplates } from '../../src/modules/consent/consentNotices';
import { assertConsentPermits, type ConsentActivity } from '../../src/modules/consent/consentPolicy';
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
 * Step 5, stage 5C: purpose-specific, versioned, append-only consent through the real HTTP API,
 * plus the backend enforcement check (assertConsentPermits) used by future screening/media/AI
 * endpoints. Synthetic data only. World: tests/db/authzFixture.ts.
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createTestApp>;
const tokens = new Map<string, string>();
const templates = new Map<string, string>(); // `${purpose}:${language}` -> templateId
const POLICY = { allowDraftNotices: true };

async function as(login: string) {
  if (!tokens.has(login)) tokens.set(login, await tokenFor(app, login));
  return api(app, tokens.get(login)!);
}

let n = 0;
/** A V1 child with a mother (may consent) and a grandparent (may not). */
async function childWithFamily(login = 'asha1', area = 'V1') {
  n += 1;
  const res = await (
    await as(login)
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: `Synthetic Consent Child ${'abcdefghijklmnopqrstuvwxyz'[n % 26]}${'zyxwvutsrqponmlkjihgfedcba'[(n * 3) % 26]}`,
    dateOfBirth: `20${10 + (n % 12)}-0${1 + (n % 9)}-1${n % 9}`,
    areaId: fx.area[area]!,
    confirmNotDuplicate: true,
    guardians: [
      {
        newGuardian: { fullName: 'Synthetic Mother' },
        relationship: 'MOTHER',
        isPrimaryContact: true,
        canGiveConsent: true,
        confirmNewGuardian: true,
      },
      {
        newGuardian: { fullName: 'Synthetic Grandparent' },
        relationship: 'GRANDPARENT',
        canGiveConsent: false,
        confirmNewGuardian: true,
      },
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const child = childDetailResponseSchema.parse(res.body).child;
  const byRel = (rel: string) => child.guardians.find((g) => g.relationship === rel)!;
  return {
    id: child.id,
    mother: byRel('MOTHER').guardianId,
    grandparent: byRel('GRANDPARENT').guardianId,
    motherLink: byRel('MOTHER').relationshipId,
  };
}

function recordBody(
  purpose: ConsentPurpose,
  guardianId: string,
  decision: 'GRANTED' | 'REFUSED' = 'GRANTED',
  language = 'hi',
) {
  return {
    clientOperationId: randomUUID(),
    guardianId,
    purpose,
    decision,
    method: 'SIGNATURE',
    templateId: templates.get(`${purpose}:${language}`)!,
    evidenceReference: 'FORM-0001',
  };
}

async function decide(
  childId: string,
  purpose: ConsentPurpose,
  guardianId: string,
  decision: 'GRANTED' | 'REFUSED' = 'GRANTED',
  login = 'asha1',
) {
  clock.advance(1000); // distinct recordedAt per decision
  const res = await (
    await as(login)
  ).post(`/children/${childId}/consents`, recordBody(purpose, guardianId, decision));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return consentRecordResponseSchema.parse(res.body);
}

async function statusOf(childId: string, purpose: string, login = 'asha1') {
  const res = await (await as(login)).get(`/children/${childId}/consents`);
  expect(res.status).toBe(200);
  return childConsentsResponseSchema.parse(res.body).statuses.find((s) => s.purpose === purpose)!;
}

function check(childId: string, activity: ConsentActivity, login = 'asha1') {
  return assertConsentPermits(
    prisma,
    { userId: fx.user[login]!, requestId: `check-${randomUUID()}`, at: clock.now() },
    childId,
    activity,
    'screening.conduct',
    POLICY,
  );
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  app = createTestApp(prisma, clock);
  fx = await buildAuthzFixture(prisma, clock);
  expect(await ensureConsentTemplates(prisma)).toEqual([]);
  for (const t of await prisma.consentTemplate.findMany({ where: { version: 1 } })) {
    templates.set(`${t.purpose}:${t.languageCode}`, t.id);
  }
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

// ======================================================================= notices

describe('consent notices', () => {
  it('serves one placeholder notice per purpose, clearly marked, in Hindi and English', async () => {
    for (const language of ['hi', 'en']) {
      const res = await (await as('asha1')).get(`/consent-notices?language=${language}`);
      expect(res.status).toBe(200);
      const items = consentNoticesResponseSchema.parse(res.body).items;
      expect(items.map((i) => i.purpose).sort()).toEqual([
        'AI_PROCESSING',
        'AUDIO_CAPTURE',
        'PHOTO_CAPTURE',
        'REFERRAL_DATA_SHARING',
        'SCREENING',
        'SMS_REMINDERS',
        'VIDEO_CAPTURE',
      ]);
      expect(
        items.every((i) => i.isPlaceholder && i.approvalStatus === 'DRAFT' && i.language === language),
      ).toBe(true);
      expect(items.every((i) => i.body.startsWith('['))).toBe(true); // visible placeholder mark
      expect(items.filter((i) => !i.optional).map((i) => i.purpose)).toEqual(['SCREENING']);
    }
  });

  it('requires consent.record (supervisor -> 403) and a valid language', async () => {
    expect((await (await as('sup1')).get('/consent-notices?language=hi')).status).toBe(403);
    expect((await (await as('asha1')).get('/consent-notices?language=fr')).status).toBe(400);
  });
});

// ======================================================================= capture

describe('consent capture', () => {
  it('records a grant bound to the notice version; server sets actor and time; audit has no names', async () => {
    const c = await childWithFamily();
    clock.advance(1000);
    const res = await (
      await as('asha1')
    ).post(`/children/${c.id}/consents`, recordBody('SCREENING', c.mother));
    expect(res.status).toBe(201);
    const body = consentRecordResponseSchema.parse(res.body);
    expect(body.consent).toMatchObject({
      purpose: 'SCREENING',
      decision: 'GRANTED',
      method: 'SIGNATURE',
      noticeVersion: 1,
      noticeLanguage: 'hi',
      noticeWasPlaceholder: true,
      evidenceReference: 'FORM-0001',
      guardianId: c.mother,
      recordedAt: clock.now().toISOString(),
      recordedByName: 'Synthetic asha1',
      withdrawnAt: null,
    });
    expect(body.status).toMatchObject({ status: 'GRANTED', permitted: true, consentId: body.consent.id });
    const row = await prisma.consent.findUniqueOrThrow({ where: { id: body.consent.id } });
    expect(row.recordedById).toBe(fx.user.asha1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'consent.granted', entityId: body.consent.id },
    });
    expect(audit.details).toMatchObject({ purpose: 'SCREENING', guardianId: c.mother, noticeVersion: 1 });
    expect(JSON.stringify(audit)).not.toContain('Synthetic Mother');
  });

  it('records a refusal; refusal never permits', async () => {
    const c = await childWithFamily();
    const { status } = await decide(c.id, 'PHOTO_CAPTURE', c.mother, 'REFUSED');
    expect(status).toMatchObject({ status: 'REFUSED', permitted: false });
    expect(
      await prisma.auditLog.count({ where: { action: 'consent.refused', entityId: status.consentId! } }),
    ).toBe(1);
  });

  it('missing consent is NOT_RECORDED, never permission', async () => {
    const c = await childWithFamily();
    const statuses = childConsentsResponseSchema.parse(
      (await (await as('asha1')).get(`/children/${c.id}/consents`)).body,
    ).statuses;
    expect(statuses).toHaveLength(7);
    expect(statuses.every((s) => s.status === 'NOT_RECORDED' && !s.permitted && s.consentId === null)).toBe(
      true,
    );
  });

  it('wrong guardian: one without consent authority (422) or not linked to the child (422) - nothing written, audited', async () => {
    const c = await childWithFamily();
    const noAuthority = await (
      await as('asha1')
    ).post(`/children/${c.id}/consents`, recordBody('SCREENING', c.grandparent));
    expect(noAuthority.status).toBe(422);
    expect(noAuthority.body.error.code).toBe('GUARDIAN_NOT_AUTHORISED');
    const otherFamily = await (
      await as('asha1')
    ).post(`/children/${c.id}/consents`, recordBody('SCREENING', fx.linked.C6.guardian));
    expect(otherFamily.status).toBe(422);
    expect(otherFamily.body.error.code).toBe('GUARDIAN_NOT_LINKED');
    expect(await prisma.consent.count({ where: { childId: c.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'consent.record_denied', entityId: c.id } })).toBe(
      2,
    );
  });

  it('wrong notice: another purpose or unknown template (422), outdated version (409)', async () => {
    const c = await childWithFamily();
    const otherPurpose = {
      ...recordBody('SCREENING', c.mother),
      templateId: templates.get('PHOTO_CAPTURE:hi'),
    };
    expect((await (await as('asha1')).post(`/children/${c.id}/consents`, otherPurpose)).body.error.code).toBe(
      'NOTICE_MISMATCH',
    );
    const unknown = { ...recordBody('SCREENING', c.mother), templateId: randomUUID() };
    expect((await (await as('asha1')).post(`/children/${c.id}/consents`, unknown)).status).toBe(422);

    // A newer version of the SCREENING (hi) notice exists: version 1 may no longer be recorded.
    const v2 = await prisma.consentTemplate.create({
      data: {
        purpose: 'SCREENING',
        version: 2,
        languageCode: 'hi',
        textSha256: 'f'.repeat(64),
        status: 'DRAFT',
      },
    });
    try {
      const outdated = await (
        await as('asha1')
      ).post(`/children/${c.id}/consents`, recordBody('SCREENING', c.mother));
      expect(outdated.status).toBe(409);
      expect(outdated.body.error.code).toBe('NOTICE_OUTDATED');
      // A version with no verified wording is never served to a guardian.
      const notices = consentNoticesResponseSchema.parse(
        (await (await as('asha1')).get('/consent-notices?language=hi&purpose=SCREENING')).body,
      );
      expect(notices.items).toEqual([]);
    } finally {
      await prisma.consentTemplate.delete({ where: { id: v2.id } });
    }
    expect(await prisma.consent.count({ where: { childId: c.id } })).toBe(0);
  });

  it.each([
    ['recordedById', { recordedById: '00000000-0000-4000-8000-000000000001' }],
    ['recordedAt', { recordedAt: '2020-01-01T00:00:00Z' }],
    ['withdrawnAt', { withdrawnAt: null }],
    ['bundled purposes', { purpose: ['SCREENING', 'PHOTO_CAPTURE'] }],
    ['unknown purpose', { purpose: 'RESEARCH' }],
    ['unknown method', { method: 'CHECKBOX' }],
  ])('rejects %s (400)', async (_name, extra) => {
    const c = await childWithFamily();
    const res = await (
      await as('asha1')
    ).post(`/children/${c.id}/consents`, { ...recordBody('SCREENING', c.mother), ...extra });
    expect(res.status).toBe(400);
  });

  it('retries and double taps create one record', async () => {
    const c = await childWithFamily();
    const body = recordBody('SMS_REMINDERS', c.mother);
    const [a, b] = await Promise.all([
      (await as('asha1')).post(`/children/${c.id}/consents`, body),
      (await as('asha1')).post(`/children/${c.id}/consents`, body),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.consent.id).toBe(b.body.consent.id);
    const retry = await (await as('asha1')).post(`/children/${c.id}/consents`, body);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(await prisma.consent.count({ where: { childId: c.id } })).toBe(1);
  });

  it('simultaneous different decisions for one purpose are both kept; the status follows the latest', async () => {
    const c = await childWithFamily();
    clock.advance(1000);
    await Promise.all([
      (await as('asha1')).post(
        `/children/${c.id}/consents`,
        recordBody('AUDIO_CAPTURE', c.mother, 'GRANTED'),
      ),
      (await as('asha1')).post(
        `/children/${c.id}/consents`,
        recordBody('AUDIO_CAPTURE', c.mother, 'REFUSED'),
      ),
    ]);
    const rows = await prisma.consent.findMany({
      where: { childId: c.id },
      orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(rows).toHaveLength(2);
    const status = await statusOf(c.id, 'AUDIO_CAPTURE');
    expect(status.consentId).toBe(rows[0]!.id);
    expect(status.status).toBe(rows[0]!.decision);
  });
});

// ======================================================================= history + access

describe('consent history and access', () => {
  it('history is newest first and complete; supervisor may read but not record; other areas get 404', async () => {
    const c = await childWithFamily();
    await decide(c.id, 'SCREENING', c.mother);
    await decide(c.id, 'PHOTO_CAPTURE', c.mother, 'REFUSED');
    const res = await (await as('sup1')).get(`/children/${c.id}/consents`);
    expect(res.status).toBe(200);
    expect(childConsentsResponseSchema.parse(res.body).history.map((h) => h.purpose)).toEqual([
      'PHOTO_CAPTURE',
      'SCREENING',
    ]);
    expect(
      (await (await as('sup1')).post(`/children/${c.id}/consents`, recordBody('SCREENING', c.mother))).status,
    ).toBe(403);
    // Scenario 3: a worker without access to the child sees nothing and changes nothing.
    expect((await (await as('asha5')).get(`/children/${c.id}/consents`)).status).toBe(404);
    expect(
      (await (await as('asha5')).post(`/children/${c.id}/consents`, recordBody('SCREENING', c.mother)))
        .status,
    ).toBe(404);
    expect((await (await as('dadmin1')).get(`/children/${c.id}/consents`)).status).toBe(403);
  });

  it('scenario 4: a guardian shared with another area child never exposes that child consent', async () => {
    const own = await childWithFamily();
    await decide(own.id, 'SCREENING', own.mother);
    // The same mother is guardian of a V5 child; that child's consent is recorded by asha5.
    const other = await prisma.child.create({
      data: {
        areaId: fx.area.V5!,
        fullName: 'Synthetic Far Sibling',
        dateOfBirth: new Date('2015-03-03'),
        sexAtBirth: 'MALE',
        createdById: fx.user.stateadmin!,
      },
    });
    await prisma.childGuardian.create({
      data: { childId: other.id, guardianId: own.mother, relationship: 'MOTHER', canGiveConsent: true },
    });
    const farConsent = await decide(other.id, 'PHOTO_CAPTURE', own.mother, 'GRANTED', 'asha5');

    const res = await (await as('asha1')).get(`/children/${own.id}/consents`);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(farConsent.consent.id);
    expect(text).not.toContain(other.id);
    expect(childConsentsResponseSchema.parse(res.body).history).toHaveLength(1);
  });
});

// ======================================================================= withdrawal

describe('consent withdrawal', () => {
  it('scenario 2: withdrawal keeps history, blocks future use, leaves other purposes alone', async () => {
    const c = await childWithFamily();
    await decide(c.id, 'SCREENING', c.mother);
    const photo = await decide(c.id, 'PHOTO_CAPTURE', c.mother);
    await expect(check(c.id, 'PHOTO_CAPTURE')).resolves.toMatchObject({ PHOTO_CAPTURE: photo.consent.id });

    clock.advance(1000);
    const res = await (
      await as('asha1')
    ).post(`/children/${c.id}/consents/${photo.consent.id}/withdraw`, {
      guardianId: c.mother,
      method: 'VERBAL_WITNESSED',
      reason: 'Changed mind',
    });
    expect(res.status).toBe(200);
    const body = consentRecordResponseSchema.parse(res.body);
    expect(body.consent).toMatchObject({
      decision: 'GRANTED', // the original decision is preserved
      withdrawnAt: clock.now().toISOString(),
      withdrawnByName: 'Synthetic asha1',
      withdrawalMethod: 'VERBAL_WITNESSED',
    });
    expect(body.status).toMatchObject({ status: 'WITHDRAWN', permitted: false });

    await expect(check(c.id, 'PHOTO_CAPTURE')).rejects.toMatchObject({
      statusCode: 403,
      code: 'CONSENT_REQUIRED',
    });
    await expect(check(c.id, 'AI_IMAGE_ANALYSIS')).rejects.toMatchObject({ statusCode: 403 });
    await expect(check(c.id, 'SCREENING')).resolves.toBeDefined(); // unrelated purpose unaffected

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'consent.withdrawn', entityId: photo.consent.id },
    });
    expect(audit.details).toMatchObject({ purpose: 'PHOTO_CAPTURE', method: 'VERBAL_WITNESSED' });
    expect(JSON.stringify(audit)).not.toContain('Changed mind');
    const history = childConsentsResponseSchema.parse(
      (await (await as('asha1')).get(`/children/${c.id}/consents`)).body,
    ).history;
    expect(history.find((h) => h.id === photo.consent.id)).toMatchObject({
      decision: 'GRANTED',
      withdrawalMethod: 'VERBAL_WITNESSED',
    });
  });

  it('repeated withdrawal (409), refused record (409), superseded grant (409)', async () => {
    const c = await childWithFamily();
    const first = await decide(c.id, 'VIDEO_CAPTURE', c.mother);
    const withdraw = async (id: string) =>
      (await as('asha1')).post(`/children/${c.id}/consents/${id}/withdraw`, {
        guardianId: c.mother,
        method: 'SIGNATURE',
      });

    const second = await decide(c.id, 'VIDEO_CAPTURE', c.mother); // newer grant supersedes the first
    expect((await withdraw(first.consent.id)).body.error.code).toBe('NOT_CURRENT_CONSENT');
    expect((await withdraw(second.consent.id)).status).toBe(200);
    expect((await withdraw(second.consent.id)).body.error.code).toBe('ALREADY_WITHDRAWN');
    const refused = await decide(c.id, 'VIDEO_CAPTURE', c.mother, 'REFUSED');
    expect((await withdraw(refused.consent.id)).body.error.code).toBe('NOT_WITHDRAWABLE');
  });

  it('simultaneous withdrawals: exactly one succeeds', async () => {
    const c = await childWithFamily();
    const grant = await decide(c.id, 'SMS_REMINDERS', c.mother);
    const path = `/children/${c.id}/consents/${grant.consent.id}/withdraw`;
    const body = { guardianId: c.mother, method: 'SIGNATURE' };
    const [a, b] = await Promise.all([
      (await as('asha1')).post(path, body),
      (await as('asha1')).post(path, body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('unauthorised withdrawals: guardian without authority (422), other area worker (404), supervisor (403)', async () => {
    const c = await childWithFamily();
    const grant = await decide(c.id, 'SCREENING', c.mother);
    const path = `/children/${c.id}/consents/${grant.consent.id}/withdraw`;
    expect(
      (await (await as('asha1')).post(path, { guardianId: c.grandparent, method: 'SIGNATURE' })).body.error
        .code,
    ).toBe('GUARDIAN_NOT_AUTHORISED');
    expect((await (await as('asha5')).post(path, { guardianId: c.mother, method: 'SIGNATURE' })).status).toBe(
      404,
    );
    expect((await (await as('sup1')).post(path, { guardianId: c.mother, method: 'SIGNATURE' })).status).toBe(
      403,
    );
    expect((await statusOf(c.id, 'SCREENING')).status).toBe('GRANTED');
  });

  it('scenario 5: a consent id of another child in this child URL is refused (404, audited)', async () => {
    const c = await childWithFamily();
    const foreign = fx.linked.C6.consent;
    const res = await (
      await as('asha1')
    ).post(`/children/${c.id}/consents/${foreign}/withdraw`, { guardianId: c.mother, method: 'SIGNATURE' });
    expect(res.status).toBe(404);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'consent.access_denied', requestId: res.headers['x-request-id'] as string },
    });
    expect(audit?.details).toMatchObject({ recordExists: true });
    expect((await prisma.consent.findUniqueOrThrow({ where: { id: foreign } })).withdrawnAt).toBeNull();
  });

  it('consent can be granted again after withdrawal (new record)', async () => {
    const c = await childWithFamily();
    const grant = await decide(c.id, 'REFERRAL_DATA_SHARING', c.mother);
    await (
      await as('asha1')
    ).post(`/children/${c.id}/consents/${grant.consent.id}/withdraw`, {
      guardianId: c.mother,
      method: 'SIGNATURE',
    });
    const again = await decide(c.id, 'REFERRAL_DATA_SHARING', c.mother);
    expect(again.consent.id).not.toBe(grant.consent.id);
    expect(again.status.status).toBe('GRANTED');
    expect(await prisma.consent.count({ where: { childId: c.id } })).toBe(2);
  });
});

// ======================================================================= enforcement

describe('backend consent enforcement (assertConsentPermits)', () => {
  it('scenario 1: screening granted, photo refused -> screening allowed; photo and AI image analysis blocked', async () => {
    const c = await childWithFamily();
    await decide(c.id, 'SCREENING', c.mother);
    await decide(c.id, 'PHOTO_CAPTURE', c.mother, 'REFUSED');
    await expect(check(c.id, 'SCREENING')).resolves.toHaveProperty('SCREENING');
    await expect(check(c.id, 'PHOTO_CAPTURE')).rejects.toMatchObject({
      statusCode: 403,
      code: 'CONSENT_REQUIRED',
      details: {
        activity: 'PHOTO_CAPTURE',
        missing: [{ purpose: 'PHOTO_CAPTURE', status: 'REFUSED', reason: null }],
      },
    });
    await expect(check(c.id, 'AI_IMAGE_ANALYSIS')).rejects.toMatchObject({
      details: {
        missing: [
          { purpose: 'PHOTO_CAPTURE', status: 'REFUSED' },
          { purpose: 'AI_PROCESSING', status: 'NOT_RECORDED' },
        ],
      },
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'consent.check_denied', entityId: c.id, outcome: 'DENIED' },
      }),
    ).toBe(2);
  });

  it('consents never imply each other: photo does not cover video, AI needs its own consent', async () => {
    const c = await childWithFamily();
    await decide(c.id, 'SCREENING', c.mother);
    await decide(c.id, 'PHOTO_CAPTURE', c.mother);
    await expect(check(c.id, 'PHOTO_CAPTURE')).resolves.toBeDefined();
    await expect(check(c.id, 'VIDEO_CAPTURE')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(check(c.id, 'AI_IMAGE_ANALYSIS')).rejects.toMatchObject({
      details: { missing: [{ purpose: 'AI_PROCESSING', status: 'NOT_RECORDED' }] },
    });
    // Photo consent without screening participation is not enough either.
    const d = await childWithFamily();
    await decide(d.id, 'PHOTO_CAPTURE', d.mother);
    await expect(check(d.id, 'PHOTO_CAPTURE')).rejects.toMatchObject({
      details: { missing: [{ purpose: 'SCREENING', status: 'NOT_RECORDED' }] },
    });
  });

  it('a later refusal by another authorised guardian overrides an earlier grant', async () => {
    const c = await childWithFamily();
    await (
      await as('asha1')
    ).patch(
      `/children/${c.id}/guardians/${(await prisma.childGuardian.findFirstOrThrow({ where: { childId: c.id, guardianId: c.grandparent } })).id}`,
      { canGiveConsent: true },
    );
    await decide(c.id, 'SCREENING', c.mother, 'GRANTED');
    await decide(c.id, 'SCREENING', c.grandparent, 'REFUSED');
    expect(await statusOf(c.id, 'SCREENING')).toMatchObject({ status: 'REFUSED', permitted: false });
    await expect(check(c.id, 'SCREENING')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('a grant stops counting when the guardian loses consent authority or is unlinked', async () => {
    const c = await childWithFamily();
    await decide(c.id, 'SCREENING', c.mother);
    const patch = await (
      await as('asha1')
    ).patch(`/children/${c.id}/guardians/${c.motherLink}`, { canGiveConsent: false });
    expect(patch.status).toBe(200);
    expect(await statusOf(c.id, 'SCREENING')).toMatchObject({
      status: 'NOT_VALID',
      reason: 'GUARDIAN_NOT_AUTHORISED',
      permitted: false,
    });
    await expect(check(c.id, 'SCREENING')).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });

    await (await as('asha1')).patch(`/children/${c.id}/guardians/${c.motherLink}`, { canGiveConsent: true });
    expect((await statusOf(c.id, 'SCREENING')).status).toBe('GRANTED');
    const ended = await (
      await as('asha1')
    ).delete(`/children/${c.id}/guardians/${c.motherLink}`, { reason: 'Synthetic test' });
    expect(ended.status).toBe(200);
    expect(await statusOf(c.id, 'SCREENING')).toMatchObject({
      status: 'NOT_VALID',
      reason: 'GUARDIAN_NO_LONGER_LINKED',
    });
  });

  it('a retired notice version invalidates grants made under it', async () => {
    const c = await childWithFamily();
    await decide(c.id, 'SCREENING', c.mother);
    const id = templates.get('SCREENING:hi')!;
    await prisma.consentTemplate.update({ where: { id }, data: { status: 'RETIRED' } });
    try {
      expect(await statusOf(c.id, 'SCREENING')).toMatchObject({
        status: 'NOT_VALID',
        reason: 'NOTICE_RETIRED',
      });
    } finally {
      await prisma.consentTemplate.update({ where: { id }, data: { status: 'DRAFT' } });
    }
  });

  it('scenario 3: the check also enforces child access (another area -> 404 even with consent)', async () => {
    const c = await childWithFamily();
    await decide(c.id, 'SCREENING', c.mother);
    await expect(check(c.id, 'SCREENING', 'asha5')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ======================================================================= production policy

describe('production policy: placeholder notices are never accepted', () => {
  it('serves no draft notice, refuses recording, and treats draft-based grants as not valid', async () => {
    const c = await childWithFamily();
    await decide(c.id, 'SCREENING', c.mother); // recorded in development

    const prod = createApp({
      auth: {
        db: prisma,
        config: testAuthConfig,
        now: clock.now,
        rateLimits: { ...DEFAULT_RATE_LIMITS, loginPerIp: 1000, loginPerIpAndAccount: 1000 },
      },
      consentPolicy: { allowDraftNotices: false },
    });
    const token = (
      await request(prod).post('/api/v1/auth/login').send({ loginId: 'ASHA1', password: PASSWORD })
    ).body.accessToken as string;
    const p = api(prod, token);
    expect(
      consentNoticesResponseSchema.parse((await p.get('/consent-notices?language=hi')).body).items,
    ).toEqual([]);
    const rec = await p.post(`/children/${c.id}/consents`, recordBody('PHOTO_CAPTURE', c.mother));
    expect(rec.status).toBe(409);
    expect(rec.body.error.code).toBe('NOTICE_NOT_APPROVED');
    const statuses = childConsentsResponseSchema.parse(
      (await p.get(`/children/${c.id}/consents`)).body,
    ).statuses;
    expect(statuses.find((s) => s.purpose === 'SCREENING')).toMatchObject({
      status: 'NOT_VALID',
      reason: 'NOTICE_NOT_APPROVED',
    });
  });
});
