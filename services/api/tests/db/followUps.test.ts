import { randomUUID } from 'node:crypto';
import {
  aggregateReportSchema,
  childDetailResponseSchema,
  followUpListResponseSchema,
  followUpResponseSchema,
  notificationListResponseSchema,
  referralDashboardSchema,
  referralResponseSchema,
  resultDashboardSchema,
  screeningProtocolDetailResponseSchema,
  screeningSessionResponseSchema,
  type FollowUpDetail,
  type ReferralDetail,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { ensureDemoRuleSets } from '../../src/modules/clinical-rules/demoRuleSets';
import { ensureConsentTemplates } from '../../src/modules/consent/consentNotices';
import { runReminders } from '../../src/modules/notifications/reminders';
import { ensureDemoProtocols } from '../../src/modules/screening/demoProtocols';
import { testAuthConfig } from './authFixture';
import { api, buildAuthzFixture, TestClock, tokenFor, type AuthzFixture } from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Step 7 stage 7D: referral tracking, closure, corrections, follow-ups, notifications, reminders,
 * dashboards and aggregate reports - real API and database, SYNTHETIC data only.
 * Users (authzFixture): asha1 (V1, district D1), ashaboth (V1 + V5), asha2 (V2 only), asha5 (V5,
 * other district), sup1 (supervisor over B1 incl. V1), dadmin1 (district admin D1); mht1 (created
 * here) is a medical officer in V1.
 */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createApp>;
const tokens = new Map<string, string>();
const questions = new Map<string, Record<string, string>>();
let facilityId = '';
const DAY = 86_400_000;

async function as(login: string) {
  if (!tokens.has(login)) tokens.set(login, await tokenFor(app, login));
  return api(app, tokens.get(login)!);
}
const ok = <T>(res: request.Response, parse: (b: unknown) => T, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return parse(res.body);
};
const ref = (res: request.Response, status = 200): ReferralDetail =>
  ok(res, (b) => referralResponseSchema.parse(b).referral, status);
const fu = (res: request.Response, status = 200): FollowUpDetail =>
  ok(res, (b) => followUpResponseSchema.parse(b).followUp, status);
const indiaDate = (offsetDays: number) =>
  new Date(clock.now().getTime() + 5.5 * 3_600_000 + offsetDays * DAY).toISOString().slice(0, 10);

let seq = 0;
async function newChild() {
  seq += 1;
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const res = await (
    await as('asha1')
  ).post('/children', {
    clientOperationId: randomUUID(),
    fullName: `Synthetic Followup ${letters[seq % 26]}${letters[(seq * 5) % 26]}${letters[(seq * 11) % 26]}`,
    dateOfBirth: '2017-02-10',
    sexAtBirth: 'FEMALE',
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
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const child = childDetailResponseSchema.parse(res.body).child;
  for (const purpose of ['SCREENING', 'REFERRAL_DATA_SHARING']) {
    const template = await prisma.consentTemplate.findFirstOrThrow({
      where: { purpose: purpose as never, version: 1, languageCode: 'hi' },
    });
    const c = await (
      await as('asha1')
    ).post(`/children/${child.id}/consents`, {
      clientOperationId: randomUUID(),
      guardianId: child.guardians[0]!.guardianId,
      purpose,
      decision: 'GRANTED',
      method: 'SIGNATURE',
      templateId: template.id,
    });
    expect(c.status).toBe(201);
  }
  return { id: child.id, name: child.fullName };
}

/** A referral of a new V1 child, created by asha1, approved by mht1 and issued by asha1. */
async function issuedReferral() {
  const child = await newChild();
  let r = ref(
    await (
      await as('asha1')
    ).post('/referrals', {
      clientOperationId: randomUUID(),
      childId: child.id,
      suggestedPriority: 'ROUTINE',
      reasonCode: 'WORKER_OBSERVED_CONCERN',
      facilityId,
    }),
    201,
  );
  r = ref(
    await (await as('mht1')).post(`/referrals/${r.id}/approve`, { expectedVersion: 1, priority: 'ROUTINE' }),
  );
  r = ref(await (await as('asha1')).post(`/referrals/${r.id}/issue`, { expectedVersion: 2 }));
  return { child, r };
}

const track = async (login: string, r: ReferralDetail, toStatus: string, extra: object = {}) =>
  (await as(login)).post(`/referrals/${r.id}/tracking`, {
    expectedVersion: r.version,
    toStatus,
    source: 'FACILITY_PHONE_CALL',
    ...extra,
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
  const asha = await prisma.user.findUniqueOrThrow({ where: { id: fx.user.asha1! } });
  const mht = await prisma.user.create({
    data: {
      loginId: 'MHT1',
      passwordHash: asha.passwordHash,
      displayName: 'Synthetic MO',
      mustChangePassword: false,
    },
  });
  fx.user.mht1 = mht.id;
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
  facilityId = (
    await prisma.facility.create({
      data: {
        name: 'Synthetic Tracking PHC',
        type: 'PHC',
        areaId: fx.area.D1!,
        createdById: fx.user.stateadmin!,
        verificationStatus: 'VERIFIED',
        verifiedById: fx.user.stateadmin!,
        verifiedAt: new Date(),
        verificationReference: 'SYNTHETIC',
        acceptsReferrals: true,
      },
    })
  ).id;
  for (const p of await prisma.screeningProtocol.findMany({ where: { isDemonstration: true } })) {
    const res = await (await as('asha1')).get(`/screening-protocols/${p.id}`);
    const detail = screeningProtocolDetailResponseSchema.parse(res.body).protocol;
    questions.set(p.category, Object.fromEntries(detail.questions.map((x) => [x.code, x.id])));
  }
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

// ===================================================================== tracking

describe('referral tracking after issue', () => {
  it('medical officers / supervisors enter updates with source and verification; workers cannot', async () => {
    const { r } = await issuedReferral();
    expect((await track('asha1', r, 'ACKNOWLEDGED')).status).toBe(403);
    const ack = ref(
      await track('sup1', r, 'ACKNOWLEDGED', { note: 'Synthetic: facility confirmed by phone' }),
    );
    const visited = ref(
      await track('sup1', ack, 'VISITED', {
        source: 'GUARDIAN_REPORTED',
        effectiveAt: clock.now().toISOString(),
      }),
    );
    expect(visited.status).toBe('VISITED');
    expect(visited.history.slice(-2)).toMatchObject([
      {
        toStatus: 'ACKNOWLEDGED',
        source: 'FACILITY_PHONE_CALL',
        verificationStatus: 'VERIFIED',
        actorRoleCode: 'SUPERVISOR',
      },
      { toStatus: 'VISITED', source: 'GUARDIAN_REPORTED', verificationStatus: 'UNVERIFIED' },
    ]);
    // The client cannot claim verification or choose "first-hand" sources.
    expect((await track('sup1', visited, 'UNDER_TREATMENT', { verificationStatus: 'VERIFIED' })).status).toBe(
      400,
    );
    expect((await track('sup1', visited, 'UNDER_TREATMENT', { source: 'APP_USER_DIRECT' })).status).toBe(400);
  });

  it('validates the move, the appointment time and the event time', async () => {
    const { r } = await issuedReferral();
    expect((await track('mht1', r, 'APPOINTMENT_SCHEDULED')).status).toBe(400);
    const wrong = await track('mht1', r, 'UNDER_TREATMENT');
    expect([wrong.status, wrong.body.error.code]).toEqual([409, 'INVALID_REFERRAL_STATE']);
    const future = await track('mht1', r, 'ACKNOWLEDGED', {
      effectiveAt: new Date(clock.now().getTime() + DAY).toISOString(),
    });
    expect(future.body.error.code).toBe('INVALID_EFFECTIVE_TIME');
    const appt = ref(
      await track('mht1', r, 'APPOINTMENT_SCHEDULED', {
        appointmentAt: new Date(clock.now().getTime() + 3 * DAY).toISOString(),
      }),
    );
    expect(appt.appointmentAt).not.toBeNull();
    // Rescheduling the appointment keeps the status.
    expect(
      ref(
        await track('mht1', appt, 'APPOINTMENT_SCHEDULED', {
          appointmentAt: new Date(clock.now().getTime() + 5 * DAY).toISOString(),
        }),
      ).status,
    ).toBe('APPOINTMENT_SCHEDULED');
  });

  it('only the latest tracking update can be corrected, with a reason; history is kept', async () => {
    const { r } = await issuedReferral();
    const ack = ref(await track('mht1', r, 'ACKNOWLEDGED'));
    const visited = ref(await track('mht1', ack, 'VISITED'));
    const visitEvent = visited.history.at(-1)!;
    const ackEvent = visited.history.at(-2)!;
    const notLatest = await (
      await as('mht1')
    ).post(`/referrals/${r.id}/corrections`, {
      expectedVersion: visited.version,
      eventId: ackEvent.id,
      reason: 'Synthetic wrong entry',
    });
    expect(notLatest.body.error.code).toBe('NOT_CORRECTABLE');
    expect(
      (
        await (
          await as('asha1')
        ).post(`/referrals/${r.id}/corrections`, {
          expectedVersion: visited.version,
          eventId: visitEvent.id,
          reason: 'x x x',
        })
      ).status,
    ).toBe(403);
    const corrected = ref(
      await (
        await as('mht1')
      ).post(`/referrals/${r.id}/corrections`, {
        expectedVersion: visited.version,
        eventId: visitEvent.id,
        reason: 'Synthetic: visit was recorded for the wrong child',
      }),
    );
    expect(corrected.status).toBe('ACKNOWLEDGED');
    expect(corrected.history.at(-1)).toMatchObject({
      correctsEventId: visitEvent.id,
      reason: 'Synthetic: visit was recorded for the wrong child',
    });
    expect(corrected.history.some((h) => h.id === visitEvent.id)).toBe(true);
    // A correction cannot itself be "corrected" back.
    const again = await (
      await as('mht1')
    ).post(`/referrals/${r.id}/corrections`, {
      expectedVersion: corrected.version,
      eventId: corrected.history.at(-1)!.id,
      reason: 'Synthetic undo',
    });
    expect(again.body.error.code).toBe('NOT_CORRECTABLE');
  });

  it('closing needs a visit outcome, a reason and no open follow-up; completing a follow-up never closes it', async () => {
    const { child, r } = await issuedReferral();
    const early = await (
      await as('mht1')
    ).post(`/referrals/${r.id}/close`, { expectedVersion: r.version, reason: 'Synthetic close' });
    expect(early.body.error.code).toBe('INVALID_REFERRAL_STATE');
    const visited = ref(await track('mht1', r, 'VISITED'));
    const task = fu(
      await (
        await as('asha1')
      ).post('/follow-ups', {
        clientOperationId: randomUUID(),
        childId: child.id,
        referralId: r.id,
        reasonCode: 'FACILITY_REQUESTED_VISIT',
        dueDate: indiaDate(3),
      }),
      201,
    );
    const blocked = await (
      await as('mht1')
    ).post(`/referrals/${r.id}/close`, { expectedVersion: visited.version, reason: 'Synthetic close' });
    expect([blocked.status, blocked.body.error.code]).toEqual([409, 'OPEN_FOLLOW_UPS']);
    fu(
      await (
        await as('asha1')
      ).post(`/follow-ups/${task.id}/complete`, {
        expectedVersion: task.version,
        outcomeNote: 'Synthetic: child seen',
      }),
    );
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('VISITED');
    const closed = ref(
      await (
        await as('mht1')
      ).post(`/referrals/${r.id}/close`, {
        expectedVersion: visited.version,
        reason: 'Synthetic: care completed',
      }),
    );
    expect(closed).toMatchObject({ status: 'CLOSED' });
    expect(closed.closedAt).not.toBeNull();
    expect((await track('mht1', closed, 'FOLLOW_UP_REQUIRED')).body.error.code).toBe(
      'INVALID_REFERRAL_STATE',
    );
  });

  it('notifies the creator (ids only, never themself); approval and issue notified too', async () => {
    const { r, child } = await issuedReferral();
    ref(await track('mht1', r, 'ACKNOWLEDGED'));
    const list = notificationListResponseSchema.parse(
      (await (await as('asha1')).get('/notifications?pageSize=50')).body,
    );
    const mine = list.items
      .filter((n) => n.entityId === r.id)
      .map((n) => n.type)
      .sort();
    // Issued by asha1 herself -> no REFERRAL_ISSUED to herself.
    expect(mine).toEqual(['REFERRAL_ACKNOWLEDGED', 'REFERRAL_APPROVED']);
    const rows = await prisma.notification.findMany({ where: { entityId: r.id } });
    expect(JSON.stringify(rows)).not.toContain(child.name);
  });
});

// ===================================================================== follow-ups

describe('follow-ups', () => {
  it("a worker's own task is assigned to them; retries are idempotent; duplicates refused", async () => {
    const { r, child } = await issuedReferral();
    const body = {
      clientOperationId: randomUUID(),
      childId: child.id,
      referralId: r.id,
      reasonCode: 'REFERRAL_NOT_COMPLETED',
      dueDate: indiaDate(2),
      reasonNote: 'SECRET synthetic note',
    };
    const created = fu(await (await as('asha1')).post('/follow-ups', body), 201);
    expect(created).toMatchObject({
      status: 'ASSIGNED',
      assignedToMe: true,
      reasonNote: 'SECRET synthetic note',
    });
    const replay = await (await as('asha1')).post('/follow-ups', body);
    expect([replay.status, replay.body.followUp.id]).toEqual([200, created.id]);
    const dup = await (await as('asha1')).post('/follow-ups', { ...body, clientOperationId: randomUUID() });
    expect(dup.body.error.code).toBe('FOLLOW_UP_ALREADY_ACTIVE');
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: created.id } })).reasonNote).toMatch(
      /^enc1:/,
    );
  });

  it('only supervisors / medical officers assign others, and only to people working in the area', async () => {
    const child = await newChild();
    const base = { childId: child.id, reasonCode: 'CLINICIAN_REQUESTED_ASSESSMENT', dueDate: indiaDate(4) };
    const byWorker = await (
      await as('asha1')
    ).post('/follow-ups', {
      ...base,
      clientOperationId: randomUUID(),
      assignToUserId: fx.user.ashaboth,
    });
    expect(byWorker.status).toBe(403);
    const task = fu(
      await (await as('sup1')).post('/follow-ups', { ...base, clientOperationId: randomUUID() }),
      201,
    );
    expect(task.status).toBe('PENDING');
    const outside = await (
      await as('sup1')
    ).post(`/follow-ups/${task.id}/assign`, { expectedVersion: 1, assignToUserId: fx.user.asha2 });
    expect(outside.body.error.code).toBe('ASSIGNEE_NOT_ELIGIBLE');
    const assigned = fu(
      await (
        await as('sup1')
      ).post(`/follow-ups/${task.id}/assign`, { expectedVersion: 1, assignToUserId: fx.user.ashaboth }),
    );
    expect(assigned).toMatchObject({ status: 'ASSIGNED', assignedToName: expect.any(String) });
    const noReason = await (
      await as('sup1')
    ).post(`/follow-ups/${task.id}/assign`, { expectedVersion: 2, assignToUserId: fx.user.asha1 });
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    expect(
      await prisma.notification.count({
        where: { userId: fx.user.ashaboth!, type: 'FOLLOW_UP_ASSIGNED', entityId: task.id },
      }),
    ).toBe(1);
  });

  it('workers act only on their own tasks; history, missed and rescheduled are kept', async () => {
    const child = await newChild();
    const task = fu(
      await (
        await as('sup1')
      ).post('/follow-ups', {
        clientOperationId: randomUUID(),
        childId: child.id,
        reasonCode: 'PROTOCOL_REASSESSMENT',
        dueDate: indiaDate(1),
        assignToUserId: fx.user.ashaboth,
      }),
      201,
    );
    const other = await (
      await as('asha1')
    ).post(`/follow-ups/${task.id}/complete`, { expectedVersion: 1, outcomeNote: 'Synthetic' });
    expect([other.status, other.body.error.code]).toEqual([403, 'FOLLOW_UP_ACTION_NOT_ALLOWED']);
    expect(
      await prisma.auditLog.count({ where: { action: 'follow_up.action_denied', entityId: task.id } }),
    ).toBe(1);
    const started = fu(
      await (await as('ashaboth')).post(`/follow-ups/${task.id}/start`, { expectedVersion: 1 }),
    );
    expect(
      (await (await as('ashaboth')).post(`/follow-ups/${task.id}/miss`, { expectedVersion: 2 })).status,
    ).toBe(400);
    const missed = fu(
      await (
        await as('ashaboth')
      ).post(`/follow-ups/${task.id}/miss`, {
        expectedVersion: started.version,
        reason: 'Synthetic: family away',
      }),
    );
    expect(missed.status).toBe('MISSED');
    const rescheduled = fu(
      await (
        await as('ashaboth')
      ).post(`/follow-ups/${task.id}/reschedule`, {
        expectedVersion: missed.version,
        dueDate: indiaDate(7),
        reason: 'Synthetic: family back next week',
      }),
    );
    expect([rescheduled.status, rescheduled.dueDate]).toEqual(['ASSIGNED', indiaDate(7)]);
    expect(rescheduled.history.map((h) => h.type)).toEqual(['CREATED', 'STARTED', 'MISSED', 'RESCHEDULED']);
    expect(rescheduled.history.at(-1)).toMatchObject({ reason: 'Synthetic: family back next week' });
    const cancelByWorker = await (
      await as('ashaboth')
    ).post(`/follow-ups/${task.id}/cancel`, {
      expectedVersion: rescheduled.version,
      reason: 'Synthetic reason',
    });
    expect(cancelByWorker.status).toBe(403);
  });

  it('overdue is computed from the due date; other districts see nothing', async () => {
    const child = await newChild();
    const task = fu(
      await (
        await as('asha1')
      ).post('/follow-ups', {
        clientOperationId: randomUUID(),
        childId: child.id,
        reasonCode: 'ADDITIONAL_SCREENING',
        dueDate: indiaDate(0),
      }),
      201,
    );
    expect(task.overdue).toBe(false);
    clock.advance(2 * DAY);
    tokens.clear();
    const overdue = followUpListResponseSchema.parse(
      (await (await as('asha1')).get('/follow-ups?overdue=true&pageSize=50')).body,
    );
    expect(overdue.items.find((i) => i.id === task.id)).toMatchObject({ overdue: true, status: 'ASSIGNED' });
    expect((await (await as('asha5')).get(`/follow-ups/${task.id}`)).status).toBe(404);
    const theirs = followUpListResponseSchema.parse(
      (await (await as('asha5')).get('/follow-ups?pageSize=50')).body,
    );
    expect(theirs.items.some((i) => i.id === task.id)).toBe(false);
  });
});

// ===================================================================== notifications & reminders

describe('notifications and reminders', () => {
  it('a completed screening notifies the medical officers; reminders are idempotent', async () => {
    const child = await newChild();
    const a = await as('asha1');
    const sessionOf = (res: request.Response) => screeningSessionResponseSchema.parse(res.body).session;
    let s = sessionOf(await a.post('/screenings', { clientOperationId: randomUUID(), childId: child.id }));
    s = sessionOf(
      await a.post(`/screenings/${s.id}/categories`, { expectedVersion: s.version, category: 'DISEASES' }),
    );
    s = sessionOf(
      await a.post(`/screenings/${s.id}/categories/DISEASES/responses`, {
        expectedVersion: s.version,
        responses: [
          {
            questionId: questions.get('DISEASES')!.DEMO_Q1,
            status: 'ANSWERED',
            source: 'WORKER_OBSERVED',
            value: false,
          },
        ],
      }),
    );
    s = sessionOf(
      await a.patch(`/screenings/${s.id}/categories/DISEASES`, {
        expectedVersion: s.version,
        status: 'COMPLETED',
      }),
    );
    await a.post(`/screenings/${s.id}/complete`, { expectedVersion: s.version });
    const review = await prisma.clinicalReview.findFirstOrThrow({
      where: { resultRun: { sessionId: s.id } },
    });
    expect(
      await prisma.notification.count({
        where: { userId: fx.user.mht1!, type: 'REVIEW_TASK_NEW', entityId: review.id },
      }),
    ).toBe(1);

    const first = await runReminders(prisma, clock.now(), {});
    const second = await runReminders(prisma, clock.now(), {});
    expect(second).toEqual({ dueSoon: 0, overdue: 0, reviewNew: 0, reviewOverdue: 0 });
    expect(first.reviewOverdue).toBe(0); // off unless configured
    const withLimit = await runReminders(prisma, new Date(clock.now().getTime() + 10 * DAY), {
      reviewOverdueHours: 48,
    });
    expect(withLimit.reviewOverdue).toBeGreaterThanOrEqual(1);
  });

  it('users see and mark only their own notifications', async () => {
    const list = notificationListResponseSchema.parse(
      (await (await as('mht1')).get('/notifications?unreadOnly=true')).body,
    );
    expect(list.unread).toBeGreaterThan(0);
    const n = list.items[0]!;
    expect((await (await as('asha5')).post(`/notifications/${n.id}/read`, {})).status).toBe(404);
    const read = await (await as('mht1')).post(`/notifications/${n.id}/read`, {});
    expect(read.body.notification.readAt).not.toBeNull();
    expect((await (await as('mht1')).post(`/notifications/${n.id}/read`, {})).status).toBe(200);
  });
});

// ===================================================================== dashboards & reports

describe('dashboards and reports', () => {
  it("dashboards count only records in the caller's scope", async () => {
    const mine = ok(await (await as('mht1')).get('/dashboards/referrals'), (b) =>
      referralDashboardSchema.parse((b as { dashboard: unknown }).dashboard),
    );
    expect(mine.referrals.issued).toBeGreaterThan(0);
    expect(mine.referrals.closed).toBeGreaterThanOrEqual(1);
    expect(mine.reviewsOpen).not.toBeNull();
    const other = ok(await (await as('asha5')).get('/dashboards/referrals'), (b) =>
      referralDashboardSchema.parse((b as { dashboard: unknown }).dashboard),
    );
    // asha5 sees exactly the referrals of children in V5 (the fixture has one), none from V1.
    const inV5 = await prisma.referral.count({ where: { child: { areaId: fx.area.V5! } } });
    expect([other.referrals.total, other.reviewsOpen]).toEqual([inV5, null]);
    expect(other.referrals.total).toBeLessThan(mine.referrals.total);
    const results = ok(await (await as('asha1')).get('/dashboards/results'), (b) =>
      resultDashboardSchema.parse((b as { dashboard: unknown }).dashboard),
    );
    expect(results.completedScreenings).toBeGreaterThan(0);
    expect(results.includesUnapprovedContent).toBe(true);
  });

  it('aggregate reports: report.aggregate in scope only, small counts suppressed, no child data', async () => {
    const q = `from=${indiaDate(-30)}&to=${indiaDate(0)}`;
    expect((await (await as('asha1')).get(`/reports/aggregate?areaId=${fx.area.D1}&${q}`)).status).toBe(403);
    expect((await (await as('dadmin1')).get(`/reports/aggregate?areaId=${fx.area.D2}&${q}`)).status).toBe(
      404,
    );
    expect(
      (
        await (
          await as('dadmin1')
        ).get(`/reports/aggregate?areaId=${fx.area.D1}&from=${indiaDate(0)}&to=${indiaDate(-1)}`)
      ).status,
    ).toBe(400);
    const res = await (await as('dadmin1')).get(`/reports/aggregate?areaId=${fx.area.D1}&${q}`);
    const report = ok(res, (b) => aggregateReportSchema.parse((b as { report: unknown }).report));
    expect(report.suppressionThreshold).toBe(5);
    for (const c of [report.referralsCreated, report.referralsIssued, report.screeningsCompleted]) {
      if (c.value !== null) expect(c.value === 0 || c.value >= 5).toBe(true);
      else expect(c.suppressed).toBe(true);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/Synthetic Followup/);
  });
});
