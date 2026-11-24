import { randomUUID } from 'node:crypto';
import {
  childDetailResponseSchema,
  facilityListResponseSchema,
  referralResponseSchema,
  reviewDetailResponseSchema,
  reviewListResponseSchema,
  screeningProtocolDetailResponseSchema,
  screeningSessionResponseSchema,
  type ReferralDetail,
  type ScreeningSessionDetail,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { ensureDemoRuleSets } from '../../src/modules/clinical-rules/demoRuleSets';
import { ensureConsentTemplates } from '../../src/modules/consent/consentNotices';
import { ensureDemoProtocols } from '../../src/modules/screening/demoProtocols';
import { testAuthConfig } from './authFixture';
import { api, buildAuthzFixture, TestClock, tokenFor, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 7 stage 7C: clinical review, referrals and facility selection through the real HTTP API
 * and database. All data is SYNTHETIC. Users (authzFixture): asha1 works in V1 (district D1);
 * asha5 in V5 (other district); sup1 supervises B1 (child.read, referral.update); mht1 and mht2
 * (created here) are medical officers in V1; mht5 is a medical officer in V5.
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createApp>;
const tokens = new Map<string, string>();
const questions = new Map<string, Record<string, string>>();
const facility: Record<string, string> = {};

async function as(login: string) {
  if (!tokens.has(login)) tokens.set(login, await tokenFor(app, login));
  return api(app, tokens.get(login)!);
}
const q = (category: string, code: string) => questions.get(category)![code]!;
function session(res: request.Response): ScreeningSessionDetail {
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return screeningSessionResponseSchema.parse(res.body).session;
}
function referral(res: request.Response, status = 200): ReferralDetail {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return referralResponseSchema.parse(res.body).referral;
}

let seq = 0;
const letters = 'abcdefghijklmnopqrstuvwxyz';
async function newChild() {
  seq += 1;
  const res = await (
    await as('asha1')
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: `Synthetic Referral ${letters[seq % 26]}${letters[(seq * 7) % 26]}${letters[(seq * 3) % 26]}`,
    dateOfBirth: '2016-04-15',
    sexAtBirth: 'MALE',
    areaId: fx.area.V1!,
    confirmNotDuplicate: true,
    guardians: [
      {
        newGuardian: { fullName: 'Synthetic Father' },
        relationship: 'FATHER',
        isPrimaryContact: true,
        canGiveConsent: true,
        confirmNewGuardian: true,
      },
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const child = childDetailResponseSchema.parse(res.body).child;
  await consent(child.id, child.guardians[0]!.guardianId, 'SCREENING');
  return { id: child.id, guardianId: child.guardians[0]!.guardianId };
}

async function consent(childId: string, guardianId: string, purpose: string) {
  const template = await prisma.consentTemplate.findFirstOrThrow({
    where: { purpose: purpose as never, version: 1, languageCode: 'hi' },
  });
  const res = await (
    await as('asha1')
  ).post(`/children/${childId}/consents`, {
    clientOperationId: randomUUID(),
    guardianId,
    purpose,
    decision: 'GRANTED',
    method: 'SIGNATURE',
    templateId: template.id,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.consent.id as string;
}

/** Completed screening of a new V1 child: DISEASES finished with DEMO_Q1 = `q1`. */
async function screened(q1 = true) {
  const child = await newChild();
  const a = await as('asha1');
  let s = session(await a.post('/screenings', { clientOperationId: randomUUID(), childId: child.id }));
  s = session(
    await a.post(`/screenings/${s.id}/categories`, { expectedVersion: s.version, category: 'DISEASES' }),
  );
  s = session(
    await a.post(`/screenings/${s.id}/categories/DISEASES/responses`, {
      expectedVersion: s.version,
      responses: [
        { questionId: q('DISEASES', 'DEMO_Q1'), status: 'ANSWERED', source: 'WORKER_OBSERVED', value: q1 },
      ],
    }),
  );
  s = session(
    await a.patch(`/screenings/${s.id}/categories/DISEASES`, {
      expectedVersion: s.version,
      status: 'COMPLETED',
    }),
  );
  s = session(await a.post(`/screenings/${s.id}/complete`, { expectedVersion: s.version }));
  const review = await prisma.clinicalReview.findFirstOrThrow({ where: { resultRun: { sessionId: s.id } } });
  return { child, s, reviewId: review.id };
}

async function createReferral(childId: string, extra: object = {}, login = 'asha1') {
  return (await as(login)).post('/referrals', {
    clientOperationId: randomUUID(),
    childId,
    suggestedPriority: 'ROUTINE',
    reasonCode: 'WORKER_OBSERVED_CONCERN',
    ...extra,
  });
}

async function addUser(login: string, area: string) {
  const asha = await prisma.user.findUniqueOrThrow({ where: { id: fx.user.asha1! } });
  const u = await prisma.user.create({
    data: {
      loginId: login.toUpperCase(),
      passwordHash: asha.passwordHash,
      displayName: `Synthetic ${login}`,
      mustChangePassword: false,
    },
  });
  fx.user[login] = u.id;
  await prisma.workerAreaAssignment.create({
    data: {
      userId: u.id,
      areaId: fx.area[area]!,
      roleId: fx.role.MHT_MEDICAL_OFFICER!,
      scope: 'AREA_ONLY',
      effectiveFrom: new Date(clock.now().getTime() - 1000),
      createdById: fx.user.stateadmin!,
    },
  });
}

async function addFacility(key: string, data: Record<string, unknown>) {
  const f = await prisma.facility.create({
    data: {
      name: `Synthetic ${key}`,
      type: 'PHC',
      areaId: fx.area.D1!,
      createdById: fx.user.stateadmin!,
      ...data,
    } as never,
  });
  facility[key] = f.id;
}
const verified = () => ({
  verificationStatus: 'VERIFIED',
  verifiedById: fx.user.stateadmin!,
  verifiedAt: new Date(),
  verificationReference: 'SYNTHETIC-VERIFY',
  acceptsReferrals: true,
});

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
  await ensureDemoRuleSets(prisma);
  await addUser('mht1', 'V1');
  await addUser('mht2', 'V1');
  await addUser('mht5', 'V5');
  await addFacility('IN', verified());
  await addFacility('UNVERIFIED', { type: 'CHC' });
  await addFacility('OTHER_DISTRICT', { ...verified(), areaId: fx.area.D2!, type: 'DISTRICT_HOSPITAL' });
  await addFacility('STATE', { ...verified(), areaId: fx.area.UP!, type: 'MEDICAL_COLLEGE' });
  for (const p of await prisma.screeningProtocol.findMany({ where: { isDemonstration: true } })) {
    const res = await (await as('asha1')).get(`/screening-protocols/${p.id}`);
    const detail = screeningProtocolDetailResponseSchema.parse(res.body).protocol;
    questions.set(p.category, Object.fromEntries(detail.questions.map((x) => [x.code, x.id])));
  }
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

// ===================================================================== clinical review

describe('clinical review', () => {
  it('only medical officers in scope see the queue and the review (404 + audit elsewhere)', async () => {
    const { reviewId } = await screened();
    const queue = reviewListResponseSchema.parse(
      (await (await as('mht1')).get('/clinical-reviews?pageSize=50')).body,
    );
    expect(queue.items.some((r) => r.id === reviewId)).toBe(true);
    expect((await (await as('asha1')).get('/clinical-reviews')).status).toBe(403);
    const other = reviewListResponseSchema.parse(
      (await (await as('mht5')).get('/clinical-reviews?pageSize=50')).body,
    );
    expect(other.items.some((r) => r.id === reviewId)).toBe(false);
    expect((await (await as('mht5')).get(`/clinical-reviews/${reviewId}`)).status).toBe(404);
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: fx.user.mht5!, entityId: reviewId, outcome: 'DENIED' },
      }),
    ).toBe(1);
  });

  it('claim: one reviewer at a time; stale versions refused; reviewer comes from the session', async () => {
    const { reviewId } = await screened();
    expect(
      (
        await (
          await as('mht1')
        ).post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 1, reviewerId: fx.user.mht2 })
      ).status,
    ).toBe(400);
    const claimed = reviewDetailResponseSchema.parse(
      (await (await as('mht1')).post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 1 })).body,
    ).review;
    expect(claimed).toMatchObject({ status: 'UNDER_REVIEW', claimedByMe: true, canDecide: true });
    const stale = await (
      await as('mht2')
    ).post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 1 });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'VERSION_CONFLICT']);
    const taken = await (
      await as('mht2')
    ).post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 2 });
    expect([taken.status, taken.body.error.code]).toEqual([409, 'REVIEW_CLAIMED']);
    const notMine = await (
      await as('mht2')
    ).post(`/clinical-reviews/${reviewId}/decision`, {
      expectedVersion: 2,
      decision: 'ACCEPT_RESULT',
    });
    expect(notMine.body.error.code).toBe('NOT_YOUR_REVIEW');
    // Release and re-claim by the other medical officer.
    await (await as('mht1')).post(`/clinical-reviews/${reviewId}/release`, { expectedVersion: 2 });
    const second = await (
      await as('mht2')
    ).post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 3 });
    expect(second.body.review.claimedByName).toBe('Synthetic mht2');
  });

  it('decisions: notes required (except accept), stored encrypted, full history, no notes in audit', async () => {
    const { reviewId } = await screened();
    const mo = await as('mht1');
    await mo.post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 1 });
    expect(
      (
        await mo.post(`/clinical-reviews/${reviewId}/decision`, {
          expectedVersion: 2,
          decision: 'REJECT_WITH_REASON',
        })
      ).status,
    ).toBe(400);
    const res = await mo.post(`/clinical-reviews/${reviewId}/decision`, {
      expectedVersion: 2,
      decision: 'REJECT_WITH_REASON',
      notes: 'SECRET-NOTE synthetic reason',
    });
    const review = reviewDetailResponseSchema.parse(res.body).review;
    expect(review).toMatchObject({
      status: 'REJECTED',
      decision: 'REJECT_WITH_REASON',
      decidedByRoleCode: 'MHT_MEDICAL_OFFICER',
    });
    expect(review.notes).toBe('SECRET-NOTE synthetic reason');
    expect(review.history.map((h) => h.toStatus)).toEqual(['PENDING_REVIEW', 'UNDER_REVIEW', 'REJECTED']);
    const row = await prisma.clinicalReview.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.notes).toMatch(/^enc1:/);
    const audits = await prisma.auditLog.findMany({ where: { entityId: reviewId } });
    expect(JSON.stringify(audits)).not.toContain('SECRET-NOTE');
    // A completed review cannot be claimed again.
    expect(
      (await mo.post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 3 })).body.error.code,
    ).toBe('REVIEW_COMPLETED');
  });

  it('RECOMMEND_REFERRAL creates an APPROVED referral linked to the review (the review is the approval)', async () => {
    const { reviewId, s } = await screened();
    const mo = await as('mht1');
    await mo.post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 1 });
    const res = await mo.post(`/clinical-reviews/${reviewId}/decision`, {
      expectedVersion: 2,
      decision: 'RECOMMEND_REFERRAL',
      notes: 'Synthetic recommendation',
      referral: { category: 'DISEASES', priority: 'PRIORITY', facilityId: facility.IN },
    });
    const review = reviewDetailResponseSchema.parse(res.body).review;
    expect(review.status).toBe('REVIEWED');
    const r = referral(await mo.get(`/referrals/${review.referralIds[0]}`));
    expect(r).toMatchObject({
      status: 'APPROVED',
      origin: 'CLINICAL_REVIEW',
      priority: 'PRIORITY',
      sessionId: s.id,
      clinicalReviewId: reviewId,
      approvedByName: 'Synthetic mht1',
      facilityId: facility.IN,
    });
    expect(r.screeningResultId).not.toBeNull();
  });

  it('REQUEST_ADDITIONAL_SCREENING creates a follow-up task with a valid due date', async () => {
    const { reviewId } = await screened();
    const mo = await as('mht1');
    await mo.post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 1 });
    const base = {
      expectedVersion: 2,
      decision: 'REQUEST_ADDITIONAL_SCREENING',
      notes: 'Synthetic: repeat the screening',
    };
    const past = await mo.post(`/clinical-reviews/${reviewId}/decision`, {
      ...base,
      followUp: { dueDate: '2020-01-01' },
    });
    expect([past.status, past.body.error.code]).toEqual([422, 'INVALID_DUE_DATE']);
    const due = new Date(clock.now().getTime() + 10 * 86_400_000).toISOString().slice(0, 10);
    const res = await mo.post(`/clinical-reviews/${reviewId}/decision`, {
      ...base,
      followUp: { dueDate: due },
    });
    const review = reviewDetailResponseSchema.parse(res.body).review;
    expect(review.status).toBe('ADDITIONAL_INFORMATION_REQUIRED');
    const task = await prisma.followUp.findUniqueOrThrow({
      where: { id: review.followUpIds[0] },
      include: { events: true },
    });
    expect(task).toMatchObject({
      status: 'PENDING',
      reasonCode: 'ADDITIONAL_SCREENING',
      clinicalReviewId: reviewId,
    });
    expect(task.events.map((e) => e.type)).toEqual(['CREATED']);
  });

  it('ESCALATE, then another medical officer re-opens it; the earlier decision stays in the history', async () => {
    const { reviewId } = await screened();
    await (await as('mht1')).post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 1 });
    await (
      await as('mht1')
    ).post(`/clinical-reviews/${reviewId}/decision`, {
      expectedVersion: 2,
      decision: 'ESCALATE_FOR_SPECIALIST_REVIEW',
      notes: 'Synthetic: needs a specialist',
    });
    const reopened = reviewDetailResponseSchema.parse(
      (await (await as('mht2')).post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 3 })).body,
    ).review;
    expect(reopened).toMatchObject({ status: 'UNDER_REVIEW', decision: null });
    expect(reopened.history.map((h) => h.decision)).toContain('ESCALATE_FOR_SPECIALIST_REVIEW');
  });

  it('the review of an amended (superseded) version cannot be claimed', async () => {
    const { reviewId, s } = await screened();
    const amended = await (
      await as('asha1')
    ).post(`/screenings/${s.id}/amendments`, {
      clientOperationId: randomUUID(),
      expectedSequence: 0,
      reason: 'Synthetic correction',
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
    expect(amended.status).toBe(201);
    const res = await (await as('mht1')).post(`/clinical-reviews/${reviewId}/claim`, { expectedVersion: 1 });
    expect([res.status, res.body.error.code]).toEqual([409, 'RESULT_SUPERSEDED']);
  });
});

// ===================================================================== referrals

describe('referral creation', () => {
  it('a worker referral waits for approval; retries are idempotent; duplicates refused', async () => {
    const { child, s } = await screened();
    const op = randomUUID();
    const body = {
      clientOperationId: op,
      childId: child.id,
      sessionId: s.id,
      category: 'DISEASES',
      suggestedPriority: 'ROUTINE',
      reasonCode: 'WORKER_OBSERVED_CONCERN',
      reasonNote: 'SECRET synthetic observation',
    };
    const first = referral(await (await as('asha1')).post('/referrals', body), 201);
    expect(first).toMatchObject({
      status: 'PENDING_APPROVAL',
      origin: 'WORKER_CONCERN',
      reasonNote: 'SECRET synthetic observation',
    });
    expect(first.actions).toMatchObject({ approve: false, cancel: true, issue: false });
    const replay = await (await as('asha1')).post('/referrals', body);
    expect([replay.status, replay.headers['idempotent-replay'], replay.body.referral.id]).toEqual([
      200,
      'true',
      first.id,
    ]);
    const dup = await createReferral(child.id, { sessionId: s.id, category: 'DISEASES' });
    expect([dup.status, dup.body.error.code, dup.body.error.details.referralId]).toEqual([
      409,
      'REFERRAL_ALREADY_ACTIVE',
      first.id,
    ]);
    const row = await prisma.referral.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.reasonNote).toMatch(/^enc1:/);
  });

  it('rejects client-supplied status, approver or creator (mass assignment)', async () => {
    const { child } = await newChildOnly();
    for (const extra of [
      { status: 'APPROVED' },
      { approvedById: fx.user.mht1 },
      { createdById: fx.user.mht1 },
      { origin: 'CLINICAL_REVIEW' },
    ]) {
      expect((await createReferral(child, extra)).status).toBe(400);
    }
  });

  it('RULE_RECOMMENDATION only when the current result recommends it', async () => {
    const yes = await screened(true);
    const r = referral(
      await createReferral(yes.child.id, {
        sessionId: yes.s.id,
        category: 'DISEASES',
        reasonCode: 'RULE_RECOMMENDATION',
      }),
      201,
    );
    expect(r.origin).toBe('RULE_RECOMMENDATION');
    const no = await screened(false);
    const res = await createReferral(no.child.id, {
      sessionId: no.s.id,
      category: 'DISEASES',
      reasonCode: 'RULE_RECOMMENDATION',
    });
    expect([res.status, res.body.error.code]).toEqual([422, 'NO_RULE_RECOMMENDATION']);
  });

  it('screening must be a completed screening of the same child', async () => {
    const a = await screened();
    const b = await screened();
    const res = await createReferral(a.child.id, { sessionId: b.s.id, category: 'DISEASES' });
    expect([res.status, res.body.error.code]).toEqual([422, 'SCREENING_CHILD_MISMATCH']);
  });

  it('another district cannot refer (404); facilities must be verified and in the district for workers', async () => {
    const { child } = await newChildOnly();
    expect((await createReferral(child, {}, 'asha5')).status).toBe(404);
    expect((await createReferral(child, { facilityId: facility.UNVERIFIED })).body.error.code).toBe(
      'FACILITY_NOT_AVAILABLE',
    );
    expect((await createReferral(child, { facilityId: facility.OTHER_DISTRICT })).body.error.code).toBe(
      'FACILITY_OUT_OF_DISTRICT',
    );
    expect((await createReferral(child, { facilityId: facility.STATE })).status).toBe(201);
  });
});

async function newChildOnly() {
  const c = await newChild();
  return { child: c.id, guardianId: c.guardianId };
}

describe('approval, issue, cancellation', () => {
  it('only an approver approves; priority is set by the approver; out-of-district needs a reason', async () => {
    const { child } = await newChildOnly();
    const r = referral(await createReferral(child), 201);
    expect(
      (
        await (
          await as('asha1')
        ).post(`/referrals/${r.id}/approve`, { expectedVersion: 1, priority: 'URGENT' })
      ).status,
    ).toBe(403);
    expect(
      (
        await (
          await as('sup1')
        ).post(`/referrals/${r.id}/approve`, { expectedVersion: 1, priority: 'URGENT' })
      ).status,
    ).toBe(403);
    const noReason = await (
      await as('mht1')
    ).post(`/referrals/${r.id}/approve`, {
      expectedVersion: 1,
      priority: 'URGENT',
      facilityId: facility.OTHER_DISTRICT,
    });
    expect(noReason.body.error.code).toBe('OUT_OF_DISTRICT_REASON_REQUIRED');
    const approved = referral(
      await (
        await as('mht1')
      ).post(`/referrals/${r.id}/approve`, {
        expectedVersion: 1,
        priority: 'URGENT',
        facilityId: facility.OTHER_DISTRICT,
        outOfDistrictReason: 'Synthetic: specialist service only there',
      }),
    );
    expect(approved).toMatchObject({
      status: 'APPROVED',
      priority: 'URGENT',
      approvedByName: 'Synthetic mht1',
    });
    expect(approved.outOfDistrictReason).toBe('Synthetic: specialist service only there');
    const again = await (
      await as('mht1')
    ).post(`/referrals/${r.id}/approve`, { expectedVersion: 2, priority: 'URGENT' });
    expect(again.body.error.code).toBe('INVALID_REFERRAL_STATE');
  });

  it('issue needs a facility and REFERRAL_DATA_SHARING consent, which is recorded', async () => {
    const { child, guardianId } = await newChildOnly();
    let r = referral(await createReferral(child), 201);
    r = referral(
      await (
        await as('mht1')
      ).post(`/referrals/${r.id}/approve`, { expectedVersion: 1, priority: 'ROUTINE' }),
    );
    expect(
      (await (await as('asha1')).post(`/referrals/${r.id}/issue`, { expectedVersion: 2 })).body.error.code,
    ).toBe('FACILITY_REQUIRED');
    r = referral(
      await (
        await as('mht1')
      ).patch(`/referrals/${r.id}/facility`, { expectedVersion: 2, facilityId: facility.IN }),
    );
    const noConsent = await (await as('asha1')).post(`/referrals/${r.id}/issue`, { expectedVersion: 3 });
    expect([noConsent.status, noConsent.body.error.code]).toEqual([403, 'CONSENT_REQUIRED']);
    expect(
      await prisma.auditLog.count({ where: { action: 'consent.check_denied', entityId: child } }),
    ).toBeGreaterThanOrEqual(1);
    const consentId = await consent(child, guardianId, 'REFERRAL_DATA_SHARING');
    const issued = referral(
      await (await as('asha1')).post(`/referrals/${r.id}/issue`, { expectedVersion: 3 }),
    );
    expect(issued).toMatchObject({
      status: 'ISSUED',
      sharingConsentId: consentId,
      facilityName: 'Synthetic IN',
    });
    expect(issued.consentVerifiedAt).not.toBeNull();
    expect(issued.history.map((h) => h.toStatus)).toEqual([
      'PENDING_APPROVAL',
      'APPROVED',
      'APPROVED',
      'ISSUED',
    ]);
    expect(issued.actions).toMatchObject({ cancel: false, changeFacility: false });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'referral.issued', entityId: r.id },
    });
    expect(audit.details).toMatchObject({ consentId, consentVerified: true, facilityId: facility.IN });
  });

  it('a facility deactivated after approval blocks the issue', async () => {
    const { child, guardianId } = await newChildOnly();
    await consent(child, guardianId, 'REFERRAL_DATA_SHARING');
    await addFacility(`TEMP${seq}`, verified());
    let r = referral(await createReferral(child, { facilityId: facility[`TEMP${seq}`] }), 201);
    r = referral(
      await (
        await as('mht1')
      ).post(`/referrals/${r.id}/approve`, { expectedVersion: 1, priority: 'ROUTINE' }),
    );
    await prisma.facility.update({
      where: { id: facility[`TEMP${seq}`] },
      data: {
        isActive: false,
        acceptsReferrals: false,
        deactivatedAt: new Date(),
        deactivationReason: 'Synthetic',
        version: { increment: 1 },
      },
    });
    expect(
      (await (await as('asha1')).post(`/referrals/${r.id}/issue`, { expectedVersion: 2 })).body.error.code,
    ).toBe('FACILITY_NOT_AVAILABLE');
  });

  it('reject needs a reason and is final; after issue only a medical officer or supervisor cancels', async () => {
    const { child, guardianId } = await newChildOnly();
    const r1 = referral(await createReferral(child), 201);
    expect((await (await as('mht1')).post(`/referrals/${r1.id}/reject`, { expectedVersion: 1 })).status).toBe(
      400,
    );
    referral(
      await (
        await as('mht1')
      ).post(`/referrals/${r1.id}/reject`, { expectedVersion: 1, reason: 'Synthetic: not needed' }),
    );
    expect(
      (await (await as('asha1')).post(`/referrals/${r1.id}/cancel`, { expectedVersion: 2, reason: 'x x x' }))
        .body.error.code,
    ).toBe('INVALID_REFERRAL_STATE');

    await consent(child, guardianId, 'REFERRAL_DATA_SHARING');
    let r2 = referral(await createReferral(child, { facilityId: facility.IN }), 201);
    r2 = referral(
      await (
        await as('mht1')
      ).post(`/referrals/${r2.id}/approve`, { expectedVersion: 1, priority: 'ROUTINE' }),
    );
    r2 = referral(await (await as('asha1')).post(`/referrals/${r2.id}/issue`, { expectedVersion: 2 }));
    const byWorker = await (
      await as('asha1')
    ).post(`/referrals/${r2.id}/cancel`, { expectedVersion: 3, reason: 'Synthetic reason' });
    expect([byWorker.status, byWorker.body.error.code]).toEqual([403, 'REFERRAL_ACTION_NOT_ALLOWED']);
    expect(
      await prisma.auditLog.count({ where: { action: 'referral.action_denied', entityId: r2.id } }),
    ).toBe(1);
    const cancelled = referral(
      await (
        await as('sup1')
      ).post(`/referrals/${r2.id}/cancel`, { expectedVersion: 3, reason: 'Synthetic: family moved' }),
    );
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.history.at(-1)).toMatchObject({
      toStatus: 'CANCELLED',
      reason: 'Synthetic: family moved',
      actorRoleCode: 'SUPERVISOR',
    });
    const event = await prisma.referralStatusEvent.findFirstOrThrow({
      where: { referralId: r2.id, toStatus: 'CANCELLED' },
    });
    expect(event.reason).toMatch(/^enc1:/);
  });

  it('other districts cannot read or act (404 + audit); lists stay in scope', async () => {
    const { child } = await newChildOnly();
    const r = referral(await createReferral(child), 201);
    expect((await (await as('asha5')).get(`/referrals/${r.id}`)).status).toBe(404);
    expect(
      (
        await (
          await as('mht5')
        ).post(`/referrals/${r.id}/approve`, { expectedVersion: 1, priority: 'ROUTINE' })
      ).status,
    ).toBe(404);
    const list = await (await as('asha5')).get('/referrals?pageSize=50');
    expect((list.body.items as Array<{ id: string }>).some((i) => i.id === r.id)).toBe(false);
    const awaiting = await (await as('mht1')).get('/referrals?awaitingApproval=true&pageSize=50');
    expect((awaiting.body.items as Array<{ id: string }>).some((i) => i.id === r.id)).toBe(true);
    expect((await (await as('mht1')).get('/referrals?sort=childName')).status).toBe(400);
  });

  it('an amendment after a referral flags it; a medical officer reassesses it once', async () => {
    const { child, s } = await screened();
    const r = referral(await createReferral(child.id, { sessionId: s.id, category: 'DISEASES' }), 201);
    await (
      await as('asha1')
    ).post(`/screenings/${s.id}/amendments`, {
      clientOperationId: randomUUID(),
      expectedSequence: 0,
      reason: 'Synthetic correction',
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
    const flagged = referral(await (await as('mht1')).get(`/referrals/${r.id}`));
    expect([flagged.pendingReassessments, flagged.actions.reassess]).toEqual([1, true]);
    const impactId = flagged.reassessments[0]!.id;
    expect((await (await as('asha1')).post(`/referrals/${r.id}/reassessments/${impactId}`, {})).status).toBe(
      403,
    );
    const done = referral(await (await as('mht1')).post(`/referrals/${r.id}/reassessments/${impactId}`, {}));
    expect(done.reassessments[0]).toMatchObject({
      reassessmentStatus: 'REASSESSED',
      reassessedByName: 'Synthetic mht1',
    });
    expect((await (await as('mht1')).post(`/referrals/${r.id}/reassessments/${impactId}`, {})).status).toBe(
      409,
    );
  });
});

// ===================================================================== facilities

describe('facility selection', () => {
  it('lists in-district facilities for the child, marks what can be chosen, hides out-of-district by default', async () => {
    const { child } = await newChildOnly();
    const list = facilityListResponseSchema.parse(
      (await (await as('asha1')).get(`/facilities?childId=${child}`)).body,
    );
    const byName = Object.fromEntries(list.items.map((f) => [f.name, f]));
    expect(byName['Synthetic IN']).toMatchObject({ placement: 'IN_DISTRICT', selectable: true });
    expect(byName['Synthetic STATE']).toMatchObject({ placement: 'IN_DISTRICT', selectable: true });
    expect(byName['Synthetic UNVERIFIED']).toMatchObject({ selectable: false });
    expect(byName['Synthetic OTHER_DISTRICT']).toBeUndefined();
    const all = facilityListResponseSchema.parse(
      (await (await as('mht1')).get(`/facilities?childId=${child}&includeOutOfDistrict=true`)).body,
    );
    expect(all.items.find((f) => f.name === 'Synthetic OTHER_DISTRICT')).toMatchObject({
      placement: 'OUT_OF_DISTRICT',
    });
  });

  it("another district's child -> 404; no child for a field worker -> 400; admins see their directory", async () => {
    const { child } = await newChildOnly();
    expect((await (await as('asha5')).get(`/facilities?childId=${child}`)).status).toBe(404);
    expect((await (await as('asha1')).get('/facilities')).status).toBe(400);
    const admin = facilityListResponseSchema.parse((await (await as('dadmin1')).get('/facilities')).body);
    expect(admin.items.map((f) => f.name)).toContain('Synthetic IN');
    expect(admin.items.map((f) => f.name)).not.toContain('Synthetic OTHER_DISTRICT');
  });
});
