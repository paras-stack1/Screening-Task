import { temporaryPasswordResponseSchema } from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../../src/modules/users/bootstrap';
import { DAY } from './authFixture';
import {
  api,
  buildAuthzFixture,
  createTestApp,
  TestClock,
  tokenFor,
  type AuthzFixture,
} from './authzFixture';
import { createTestPrisma, resetData } from './testDatabase';

/** Stage 3: account provisioning, assignment management, privilege escalation, bootstrap. */
let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createTestApp>;
let seq = 0;

const as = async (login: string) => api(app, await tokenFor(app, login));
const later = (ms: number) => new Date(clock.now().getTime() + ms).toISOString();

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  clock = new TestClock();
  app = createTestApp(prisma, clock);
  fx = await buildAuthzFixture(prisma, clock);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

function newUserBody(role: string, area: string, extra: object = {}) {
  seq += 1;
  return {
    loginId: `new-${seq}-emp`,
    displayName: `Synthetic New ${seq}`,
    assignment: {
      areaId: fx.area[area],
      roleId: fx.role[role],
      scope: 'AREA_ONLY',
      reason: 'Order 12/2026',
      ...extra,
    },
  };
}

async function lastAudit(action: string, actor: string) {
  return prisma.auditLog.findFirst({
    where: { action, actorUserId: fx.user[actor] },
    orderBy: { occurredAt: 'desc' },
  });
}

// ------------------------------------------------------------------- account provisioning

describe('account provisioning (POST /users)', () => {
  it('district admin creates a worker in their district; the worker must change the one-time password', async () => {
    const admin = await as('dadmin1');
    const body = newUserBody('ASHA', 'V1');
    const res = await admin.post('/users', body);
    expect(res.status).toBe(201);
    const created = temporaryPasswordResponseSchema.parse(res.body);
    expect(created.user).toMatchObject({
      loginId: 'NEW-' + body.loginId.slice(4).toUpperCase(),
      mustChangePassword: true,
      status: 'ACTIVE',
    });
    expect(created.temporaryPassword).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(JSON.stringify(res.body)).not.toContain('$argon2');

    // One-time password works, but only for changing it.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ loginId: body.loginId, password: created.temporaryPassword });
    expect(login.status).toBe(200);
    const worker = api(app, login.body.accessToken as string);
    expect((await worker.get('/children')).status).toBe(403);
    expect((await worker.get('/children')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const audit = await prisma.auditLog.findMany({
      where: { entityId: created.user.id, action: 'user.created' },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(created.temporaryPassword);
  });

  it('rejects mass-assignment fields (status, passwordHash, role on the user, createdById)', async () => {
    const admin = await as('dadmin1');
    for (const extra of [
      { status: 'ACTIVE' },
      { passwordHash: 'x' },
      { role: 'STATE_ADMIN' },
      { mustChangePassword: false },
    ]) {
      const res = await admin.post('/users', { ...newUserBody('ASHA', 'V1'), ...extra });
      expect(res.status).toBe(400);
    }
    const nested = newUserBody('ASHA', 'V1', { createdById: fx.user.stateadmin });
    expect((await admin.post('/users', nested)).status).toBe(400);
  });

  it('duplicate login ID (any spelling) -> 409', async () => {
    const admin = await as('dadmin1');
    const body = newUserBody('ASHA', 'V1');
    expect((await admin.post('/users', body)).status).toBe(201);
    const again = await admin.post('/users', {
      ...newUserBody('ASHA', 'V1'),
      loginId: ` ${body.loginId.toUpperCase()} `,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LOGIN_ID_TAKEN');
  });

  it("outside the admin's district -> 403 OUT_OF_SCOPE, audited, no account created", async () => {
    const before = await prisma.user.count();
    const res = await (await as('dadmin1')).post('/users', newUserBody('ASHA', 'V5'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUT_OF_SCOPE');
    expect(await prisma.user.count()).toBe(before);
    expect((await lastAudit('user.denied', 'dadmin1'))?.details).toEqual({
      rule: 'MISSING_MANAGE_PERMISSION',
    });
  });

  it('privilege escalation: district admin cannot create a STATE_ADMIN', async () => {
    const res = await (await as('dadmin1')).post('/users', newUserBody('STATE_ADMIN', 'D1'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_EXCEEDS_OWN_PERMISSIONS');
  });

  it('D11: fieldwork permissions are delegable, management permissions are not', async () => {
    const admin = await as('dadmin1');
    // MHT_MEDICAL_OFFICER = fieldwork only (child.*, screening.review...): admin may grant it.
    expect((await admin.post('/users', newUserBody('MHT_MEDICAL_OFFICER', 'V2'))).status).toBe(201);
    // ... yet the admin still cannot read children themselves (D3).
    expect((await admin.get('/children')).status).toBe(403);
    // A supervisor lacks user.manage (management), so cannot hand out DISTRICT_ADMIN.
    const sup = await as('sup1');
    const res = await sup.post('/assignments', {
      userId: fx.user.asha2,
      areaId: fx.area.V3,
      roleId: fx.role.DISTRICT_ADMIN,
      scope: 'AREA_ONLY',
      reason: 'Order 15/2026',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_EXCEEDS_OWN_PERMISSIONS');
  });

  it('descendant scope needs the actor to cover the whole subtree', async () => {
    const admin = await as('dadmin1');
    const ok = await admin.post(
      '/users',
      newUserBody('DISTRICT_ADMIN', 'B1', { scope: 'AREA_AND_DESCENDANTS' }),
    );
    expect(ok.status).toBe(201);
    const sup = await as('sup2'); // SUPERVISOR on B1, AREA_ONLY
    const res = await sup.post('/assignments', {
      userId: fx.user.asha2,
      areaId: fx.area.B1,
      roleId: fx.role.SUPERVISOR,
      scope: 'AREA_AND_DESCENDANTS',
      reason: 'Order 13/2026',
    });
    expect(res.status).toBe(403);
  });

  it('supervisor (assignment.manage without user.manage) cannot create accounts', async () => {
    expect((await (await as('sup1')).post('/users', newUserBody('SUPERVISOR', 'V1'))).status).toBe(403);
  });
});

// -------------------------------------------------------------------- managing accounts

describe('managing existing accounts', () => {
  it('cannot view or change a user outside scope (404), or one who also works in another district', async () => {
    const admin = await as('dadmin1');
    expect((await admin.get(`/users/${fx.user.asha5}`)).status).toBe(404);
    expect((await admin.get(`/users/${fx.user.ashaboth}`)).status).toBe(404);
    expect((await admin.get(`/users/${fx.user.stateadmin}`)).status).toBe(404);
    expect(
      (await admin.post(`/users/${fx.user.ashaboth}/status`, { status: 'SUSPENDED', reason: 'test reason' }))
        .status,
    ).toBe(404);
    expect((await (await as('stateadmin')).get(`/users/${fx.user.ashaboth}`)).status).toBe(200);
  });

  it("list shows only users inside the admin's areas, never the admin", async () => {
    const res = await (await as('dadmin1')).get('/users?pageSize=50');
    const ids = (res.body.items as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toContain(fx.user.asha1);
    expect(ids).not.toContain(fx.user.asha5);
    expect(ids).not.toContain(fx.user.dadmin1);
    expect(ids).not.toContain(fx.user.stateadmin);
    expect(res.body.total).toBe(ids.length);
  });

  it('self-modification is refused (403) and audited', async () => {
    const admin = await as('dadmin1');
    const res = await admin.post(`/users/${fx.user.dadmin1}/status`, {
      status: 'ACTIVE',
      reason: 'self change',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_MODIFICATION');
    const own = await admin.post(`/assignments/${fx.assignment['dadmin1:D1']}/end`, {
      reason: 'self change',
    });
    expect(own.status).toBe(403);
    const grant = await admin.post('/assignments', {
      userId: fx.user.dadmin1,
      areaId: fx.area.D2,
      roleId: fx.role.DISTRICT_ADMIN,
      scope: 'AREA_AND_DESCENDANTS',
      reason: 'self grant',
    });
    expect(grant.status).toBe(403);
    expect((await lastAudit('assignment.denied', 'dadmin1'))?.details).toEqual({ rule: 'SELF_MODIFICATION' });
  });

  it("suspension ends the worker's access at once; reactivation allows a new sign-in", async () => {
    const worker = await as('asha2');
    const admin = await as('dadmin1');
    expect(
      (await admin.post(`/users/${fx.user.asha2}/status`, { status: 'SUSPENDED', reason: 'on leave' }))
        .status,
    ).toBe(200);
    expect((await worker.get('/auth/me')).status).toBe(401);
    await expect(tokenFor(app, 'asha2')).rejects.toThrow(/401/);
    expect(
      (await admin.post(`/users/${fx.user.asha2}/status`, { status: 'ACTIVE', reason: 'back from leave' }))
        .status,
    ).toBe(200);
    expect((await (await as('asha2')).get('/children')).status).toBe(200);
  });

  it('sessions from before a suspension stay dead after reactivation (regression)', async () => {
    const before = await request(app)
      .post('/api/v1/auth/login')
      .send({ loginId: 'asha2', password: 'Synthetic-pass-2026' });
    const oldRefresh = before.body.refreshToken as string;
    const admin = await as('dadmin1');
    await admin.post(`/users/${fx.user.asha2}/status`, { status: 'SUSPENDED', reason: 'investigation' });
    await admin.post(`/users/${fx.user.asha2}/status`, { status: 'ACTIVE', reason: 'cleared' });
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: oldRefresh });
    expect(reuse.status).toBe(401);
    expect((await api(app, before.body.accessToken as string).get('/auth/me')).status).toBe(401);
  });

  it('deactivation is permanent', async () => {
    const admin = await as('dadmin1');
    const created = await admin.post('/users', newUserBody('DISTRICT_ADMIN', 'B2'));
    const id = created.body.user.id as string;
    expect(
      (await admin.post(`/users/${id}/status`, { status: 'DEACTIVATED', reason: 'left service' })).status,
    ).toBe(200);
    const res = await admin.post(`/users/${id}/status`, { status: 'ACTIVE', reason: 'undo' });
    expect(res.status).toBe(409);
  });

  it('password reset: new one-time password, old password and all sessions dead, lock cleared', async () => {
    const worker = await as('asha1');
    await prisma.user.update({
      where: { id: fx.user.asha1 },
      data: { lockedUntil: new Date(clock.now().getTime() + DAY) },
    });
    const res = await (
      await as('stateadmin')
    ).post(`/users/${fx.user.asha1}/reset-password`, { reason: 'forgot password' });
    expect(res.status).toBe(200);
    const { temporaryPassword } = temporaryPasswordResponseSchema.parse(res.body);
    expect((await worker.get('/auth/me')).status).toBe(401);
    await expect(tokenFor(app, 'asha1')).rejects.toThrow(/401/);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ loginId: 'asha1', password: temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    // Restore the fixture password for other tests.
    const change = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: temporaryPassword, newPassword: 'Synthetic-pass-2026' });
    expect(change.status).toBe(200);
  });

  it('admin revoke-sessions signs the user out everywhere', async () => {
    const worker = await as('aww1');
    const res = await (
      await as('dadmin1')
    ).post(`/users/${fx.user.aww1}/revoke-sessions`, { reason: 'lost phone' });
    expect(res.status).toBe(204);
    expect((await worker.get('/auth/me')).status).toBe(401);
    expect((await lastAudit('user.sessions_revoked', 'dadmin1'))?.outcome).toBe('SUCCESS');
  });

  it('a worker cannot call admin endpoints on anyone, including changing their own role', async () => {
    const worker = await as('asha1');
    expect(
      (await worker.post(`/users/${fx.user.asha1}/status`, { status: 'ACTIVE', reason: 'x x x' })).status,
    ).toBe(403);
    expect(
      (
        await worker.post('/assignments', {
          userId: fx.user.asha1,
          areaId: fx.area.UP,
          roleId: fx.role.STATE_ADMIN,
          scope: 'AREA_AND_DESCENDANTS',
          reason: 'escalate',
        })
      ).status,
    ).toBe(403);
  });
});

// ------------------------------------------------------------------- assignment lifecycle

describe('assignment management', () => {
  const grant = (body: object) => ({ reason: 'Order 14/2026', scope: 'AREA_ONLY', ...body });

  it('scenario 14: a supervisor cannot grant STATE_ADMIN (refused and audited)', async () => {
    const res = await (
      await as('sup1')
    ).post('/assignments', grant({ userId: fx.user.asha2, areaId: fx.area.V1, roleId: fx.role.STATE_ADMIN }));
    expect(res.status).toBe(403);
    expect((await lastAudit('assignment.denied', 'sup1'))?.details).toEqual({
      rule: 'ROLE_EXCEEDS_OWN_PERMISSIONS',
    });
  });

  it('a supervisor can grant an equal role inside their block, not outside it', async () => {
    const sup = await as('sup1');
    const inside = await sup.post(
      '/assignments',
      grant({ userId: fx.user.asha2, areaId: fx.area.S2, roleId: fx.role.SUPERVISOR }),
    );
    expect(inside.status).toBe(201);
    const outside = await sup.post(
      '/assignments',
      grant({ userId: fx.user.asha2, areaId: fx.area.B2, roleId: fx.role.SUPERVISOR }),
    );
    expect(outside.status).toBe(403);
    expect(outside.body.error.code).toBe('OUT_OF_SCOPE');
  });

  it('overlapping duplicate -> 409; past start date -> 400; end before start -> 400', async () => {
    const admin = await as('stateadmin');
    const dup = await admin.post(
      '/assignments',
      grant({ userId: fx.user.asha1, areaId: fx.area.V1, roleId: fx.role.ASHA }),
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ASSIGNMENT_OVERLAP');
    const past = await admin.post(
      '/assignments',
      grant({ userId: fx.user.asha5, areaId: fx.area.V4, roleId: fx.role.ASHA, effectiveFrom: later(-DAY) }),
    );
    expect(past.status).toBe(400);
    const inverted = await admin.post(
      '/assignments',
      grant({
        userId: fx.user.asha5,
        areaId: fx.area.V4,
        roleId: fx.role.ASHA,
        effectiveFrom: later(DAY),
        effectiveTo: later(1000),
      }),
    );
    expect(inverted.status).toBe(400);
  });

  it('suspend -> reactivate -> revoke; invalid transitions -> 409; every step audited', async () => {
    const admin = await as('dadmin1');
    const created = await admin.post(
      '/assignments',
      grant({ userId: fx.user.asha5, areaId: fx.area.V4, roleId: fx.role.DISTRICT_ADMIN }),
    );
    expect(created.status).toBe(201);
    const id = created.body.assignment.id as string;
    expect((await admin.post(`/assignments/${id}/reactivate`, { reason: 'not suspended' })).status).toBe(409);
    expect(
      (await admin.post(`/assignments/${id}/suspend`, { reason: 'on leave' })).body.assignment.status,
    ).toBe('SUSPENDED');
    expect(
      (await admin.post(`/assignments/${id}/reactivate`, { reason: 'back' })).body.assignment.status,
    ).toBe('ACTIVE');
    expect(
      (await admin.post(`/assignments/${id}/revoke`, { reason: 'transferred' })).body.assignment.status,
    ).toBe('REVOKED');
    expect((await admin.post(`/assignments/${id}/suspend`, { reason: 'too late' })).status).toBe(409);
    const actions = await prisma.auditLog.findMany({
      where: { entityId: id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'assignment.created',
      'assignment.suspended',
      'assignment.reactivated',
      'assignment.revoked',
    ]);
  });

  it('ending can only shorten, never extend or backdate', async () => {
    const admin = await as('dadmin1');
    const created = await admin.post(
      '/assignments',
      grant({
        userId: fx.user.asha5,
        areaId: fx.area.V3,
        roleId: fx.role.DISTRICT_ADMIN,
        effectiveTo: later(10 * DAY),
      }),
    );
    const id = created.body.assignment.id as string;
    expect(
      (await admin.post(`/assignments/${id}/end`, { effectiveTo: later(20 * DAY), reason: 'extend' })).status,
    ).toBe(400);
    expect(
      (await admin.post(`/assignments/${id}/end`, { effectiveTo: later(-DAY), reason: 'backdate' })).status,
    ).toBe(400);
    const ok = await admin.post(`/assignments/${id}/end`, { effectiveTo: later(5 * DAY), reason: 'shorten' });
    expect(ok.status).toBe(200);
    expect(ok.body.assignment.effectiveTo).toBe(later(5 * DAY));
  });

  it('an assignment in another district is invisible (404, audited)', async () => {
    const res = await (
      await as('dadmin1')
    ).post(`/assignments/${fx.assignment['asha5:V5']}/suspend`, { reason: 'probe' });
    expect(res.status).toBe(404);
    expect((await lastAudit('assignment.denied', 'dadmin1'))?.details).toEqual({ rule: 'OUT_OF_SCOPE' });
  });

  it("cannot change an assignment whose role exceeds the actor's own (403)", async () => {
    // sup1 covers B1, but SUPERVISOR lacks user.manage which DISTRICT_ADMIN holds.
    const target = await prisma.workerAreaAssignment.create({
      data: {
        userId: fx.user.asha2!,
        areaId: fx.area.V3!,
        roleId: fx.role.DISTRICT_ADMIN!,
        scope: 'AREA_ONLY',
        effectiveFrom: clock.now(),
        createdById: fx.user.stateadmin!,
      },
    });
    const res = await (await as('sup1')).post(`/assignments/${target.id}/revoke`, { reason: 'probe' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_EXCEEDS_OWN_PERMISSIONS');
  });
});

// ---------------------------------------------------------------------------- bootstrap

describe('first administrator bootstrap', () => {
  it('refuses while an active root administrator exists', async () => {
    await expect(
      bootstrapAdmin(prisma, { loginId: 'BOOT-0001', displayName: 'Boot Admin', now: clock.now() }),
    ).rejects.toThrow(/already exists/);
  });

  it('creates a root STATE_ADMIN with a one-time password once no root admin is active', async () => {
    await prisma.user.update({ where: { id: fx.user.stateadmin }, data: { status: 'SUSPENDED' } });
    try {
      const result = await bootstrapAdmin(prisma, {
        loginId: 'boot-0002',
        displayName: 'Boot Admin',
        now: clock.now(),
      });
      expect(result.loginId).toBe('BOOT-0002');
      const assignment = await prisma.workerAreaAssignment.findFirstOrThrow({
        where: { userId: result.userId },
      });
      expect(assignment).toMatchObject({
        areaId: fx.area.UP,
        scope: 'AREA_AND_DESCENDANTS',
        roleId: fx.role.STATE_ADMIN,
      });
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ loginId: 'BOOT-0002', password: result.temporaryPassword });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(true);
      await expect(
        bootstrapAdmin(prisma, { loginId: 'BOOT-0003', displayName: 'Second', now: clock.now() }),
      ).rejects.toThrow(/already exists/);
    } finally {
      await prisma.user.update({ where: { id: fx.user.stateadmin }, data: { status: 'ACTIVE' } });
    }
  });
});
