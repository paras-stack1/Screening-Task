import { randomUUID } from 'node:crypto';
import { childListResponseSchema, meResponseSchema } from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertInScopeOrDeny,
  findChildOrDeny,
  scopedWhere,
} from '../../src/modules/access-control/accessScope';
import { permissionsOverArea } from '../../src/modules/access-control/authorization.service';
import {
  api,
  buildAuthzFixture,
  createTestApp,
  TestClock,
  tokenFor,
  type AuthzFixture,
} from './authzFixture';
import { inRollback } from './scenarioFixture';
import { createTestPrisma, resetData } from './testDatabase';

/**
 * Stage 3: RBAC, geographical authorization, IDOR/BOLA and data-leakage tests on the real
 * schema, through the real HTTP API wherever an endpoint exists (decision A).
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

async function childNames(login: string, query = '') {
  const res = await (await as(login)).get(`/children${query}`);
  expect(res.status).toBe(200);
  const body = childListResponseSchema.parse(res.body);
  return { names: body.items.map((c) => c.fullName.replace('Synthetic Child ', '')), total: body.total };
}

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

// ---------------------------------------------------------------------------------- RBAC

describe('RBAC: authentication is not authorization', () => {
  it('unauthenticated -> 401', async () => {
    const res = await api(app, 'not-a-token').get('/children');
    expect(res.status).toBe(401);
  });

  it('authenticated but role lacks child.read (district admin, decision D3) -> 403, audited', async () => {
    const res = await (await as('dadmin1')).get('/children');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'authz.denied', actorUserId: fx.user.dadmin1 },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.details).toMatchObject({ permission: 'child.read', method: 'GET' });
  });

  it('a user with no assignment at all has no permissions', async () => {
    expect((await (await as('noassign')).get('/children')).status).toBe(403);
    expect((await (await as('noassign')).get('/users')).status).toBe(403);
  });

  it.each([
    ['asha1', '/users', 403],
    ['asha1', '/roles', 403],
    ['sup1', '/users', 403], // supervisor: assignment.manage but not user.manage
    ['sup1', '/roles', 200],
    ['dadmin1', '/users', 200],
    ['stateadmin', '/users', 200],
    ['stateadmin', '/children', 403], // no child.read by default (D3)
  ])('%s GET %s -> %i', async (login, path, status) => {
    expect((await (await as(login)).get(path)).status).toBe(status);
  });

  it('/auth/me reports effective permissions and assignments (UI only)', async () => {
    const res = await (await as('asha1')).get('/auth/me');
    const body = meResponseSchema.parse(res.body);
    expect(body.access.permissions).toEqual(
      [
        'child.create',
        'child.read',
        'child.update',
        'consent.record',
        'referral.create',
        'screening.conduct',
      ].sort(),
    );
    expect(body.access.assignments.map((a) => a.areaName).sort()).toEqual(['Area V1', 'Area V2']);
  });

  it('/auth/me omits ended, future, suspended and revoked assignments', async () => {
    for (const login of ['ashaended', 'ashafuture', 'ashasusp', 'ashareve']) {
      const body = meResponseSchema.parse((await (await as(login)).get('/auth/me')).body);
      expect(body.access).toEqual({ permissions: [], assignments: [] });
    }
  });
});

// ------------------------------------------------------------------ geographical access

describe('geographical access through GET /children', () => {
  it.each([
    ['worker on two villages (union, R4)', 'asha1', ['C1', 'C2']],
    ['AREA_ONLY on V1 does not reach AWC1 below it (R3)', 'asha1', ['C1', 'C2']],
    ['anganwadi worker on AWC1', 'aww1', ['C4']],
    ['supervisor on B1 with descendants', 'sup1', ['C1', 'C2', 'C3', 'C4']],
    ['supervisor on B1 without descendants (no children registered at block level)', 'sup2', []],
    ['worker in the other district', 'asha5', ['C6']],
    ['expired assignment', 'ashaended', null],
    ['future assignment', 'ashafuture', null],
    ['suspended assignment', 'ashasusp', null],
    ['revoked assignment', 'ashareve', null],
  ])('%s', async (_name, login, expected) => {
    if (expected === null) {
      // No effective assignment -> no permission at all.
      expect((await (await as(login)).get('/children')).status).toBe(403);
      return;
    }
    const { names, total } = await childNames(login);
    expect(names).toEqual(expected);
    expect(total).toBe(expected.length);
  });

  it('a deactivated account cannot sign in at all', async () => {
    await prisma.user.update({ where: { id: fx.user.ashasusp }, data: { status: 'DEACTIVATED' } });
    await expect(tokenFor(app, 'ashasusp')).rejects.toThrow(/401/);
    await prisma.user.update({ where: { id: fx.user.ashasusp }, data: { status: 'ACTIVE' } });
  });

  it('an assignment revoked during a session takes effect on the very next request (R10)', async () => {
    const before = await childNames('asha2');
    expect(before.names).toEqual(['C2']);
    await prisma.workerAreaAssignment.update({
      where: { id: fx.assignment['asha2:V2'] },
      data: { status: 'SUSPENDED' },
    });
    // Same access token, no re-login: the claim-free token carries no stale permissions.
    expect((await (await as('asha2')).get('/children')).status).toBe(403);
    await prisma.workerAreaAssignment.update({
      where: { id: fx.assignment['asha2:V2'] },
      data: { status: 'ACTIVE' },
    });
  });

  it('an assignment that ends while the user is signed in stops access at its end time', async () => {
    const end = new Date(clock.now().getTime() + 60_000);
    await prisma.workerAreaAssignment.update({
      where: { id: fx.assignment['asha2:V2'] },
      data: { effectiveTo: end },
    });
    expect((await childNames('asha2')).names).toEqual(['C2']);
    clock.advance(61_000);
    const res = await (await as('asha2')).get('/children');
    expect(res.status).toBe(403);
    await prisma.workerAreaAssignment.update({
      where: { id: fx.assignment['asha2:V2'] },
      data: { effectiveTo: null },
    });
    tokens.clear(); // the clock moved; re-sign-in where needed
  });

  it('child moved V2 -> V3: access follows the child (D4); history stays attached', async () => {
    await inRollback(prisma, async (tx) => {
      await tx.child.update({ where: { id: fx.child.C2 }, data: { areaId: fx.area.V3 } });
      const session = await tx.screeningSession.create({
        data: {
          childId: fx.child.C2!,
          protocolId: (await tx.screeningProtocol.findFirstOrThrow()).id,
          conductedById: fx.user.asha1!,
          areaId: fx.area.V2!, // historical snapshot: screened while the child lived in V2
          ageInDaysAtStart: 800,
          startedAt: clock.now(),
        },
      });
      const ctx = { userId: fx.user.asha1!, at: clock.now(), auditDb: prisma };
      // The former village's worker loses the child AND its historical session.
      await expect(findChildOrDeny(tx, ctx, fx.child.C2!, 'child.read')).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(
        assertInScopeOrDeny(tx, ctx, 'screeningSession', session.id, 'child.read'),
      ).rejects.toMatchObject({
        statusCode: 404,
      });
      // The supervisor covering both villages keeps access; the snapshot still says V2.
      await assertInScopeOrDeny(
        tx,
        { ...ctx, userId: fx.user.sup1! },
        'screeningSession',
        session.id,
        'child.read',
      );
      expect((await tx.screeningSession.findUniqueOrThrow({ where: { id: session.id } })).areaId).toBe(
        fx.area.V2,
      );
    });
  });

  it('permissions from an EXPIRED assignment do not count over an area (regression)', async () => {
    const held = await permissionsOverArea(prisma, fx.user.formeradmin!, fx.area.V1!, clock.now());
    expect(held.has('user.manage')).toBe(false); // from the ended DISTRICT_ADMIN assignment
    expect(held.has('assignment.manage')).toBe(true); // from the current SUPERVISOR assignment
  });
});

// ------------------------------------------------------------------------------ IDOR / BOLA

describe('IDOR / BOLA', () => {
  it("child profile: another area's child id gives the same 404 as a non-existent id, audited", async () => {
    const asha = await as('asha1');
    const foreign = await asha.get(`/children/${fx.child.C6}`);
    const missing = await asha.get(`/children/${randomUUID()}`);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    type ErrorBody = { error: { requestId?: string } };
    const strip = (body: unknown) => ({ ...(body as ErrorBody).error, requestId: undefined });
    expect(strip(foreign.body)).toEqual(strip(missing.body));
    expect(JSON.stringify(foreign.body)).not.toContain('Synthetic Child');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'child.access_denied', actorUserId: fx.user.asha1, entityId: fx.child.C6 },
    });
    expect(audit?.details).toMatchObject({ permission: 'child.read', recordExists: true });
  });

  it('child profile: own child is returned, with current guardians and no phone data', async () => {
    const res = await (await as('asha1')).get(`/children/${fx.child.C1}`);
    expect(res.status).toBe(200);
    expect(res.body.child.guardians).toHaveLength(1);
    // Step 5: only a masked number (none saved here) - never ciphertext, hash or a full number.
    expect(res.body.child.guardians[0].phoneMasked).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/phoneEncrypted|phoneLookupHash|createdById|deletedAt/);
    const viewed = await prisma.auditLog.count({
      where: { action: 'child.viewed', actorUserId: fx.user.asha1, entityId: fx.child.C1 },
    });
    expect(viewed).toBeGreaterThanOrEqual(1);
  });

  it('malformed child id -> 400, never a database error', async () => {
    const res = await (await as('asha1')).get("/children/1' OR '1'='1");
    expect(res.status).toBe(400);
  });

  const ENTITIES = Object.keys(scopedWhere) as Array<keyof typeof scopedWhere>;

  it.each(ENTITIES)("%s: a record of another area's child is denied (404, audited)", async (entity) => {
    const ctx = { userId: fx.user.asha1!, requestId: `idor-${entity}-${randomUUID()}` };
    await assertInScopeOrDeny(prisma, ctx, entity, fx.linked.C1[entity], 'child.read');
    await expect(
      assertInScopeOrDeny(prisma, ctx, entity, fx.linked.C6[entity], 'child.read'),
    ).rejects.toMatchObject({ statusCode: 404 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { requestId: ctx.requestId } });
    expect(audit).toMatchObject({
      action: `${entity}.access_denied`,
      outcome: 'DENIED',
      entityId: fx.linked.C6[entity],
    });
  });

  it.each(ENTITIES)('%s: list queries with the scope filter return only in-scope rows', async (entity) => {
    const where = scopedWhere[entity](fx.user.asha1!, 'child.read', clock.now());
    // Each Prisma delegate has a different type; the cast keeps the table-driven test compact.
    const delegate = {
      guardian: prisma.guardian,
      consent: prisma.consent,
      screeningSession: prisma.screeningSession,
      screeningObservation: prisma.screeningObservation,
      measurement: prisma.measurement,
      screeningResult: prisma.screeningResult,
      aiAnalysis: prisma.aiAnalysis,
      referral: prisma.referral,
      followUp: prisma.followUp,
      media: prisma.mediaMetadata,
      childTransfer: prisma.childAreaTransfer,
    }[entity] as unknown as { findMany(args: object): Promise<Array<{ id: string }>> };
    const rows = await delegate.findMany({ where, select: { id: true } });
    expect(rows.map((r) => r.id)).toContain(fx.linked.C1[entity]);
    expect(rows.map((r) => r.id)).not.toContain(fx.linked.C6[entity]);
  });

  it('guardian: visible through any CURRENT link to an accessible child only', async () => {
    const shared = await prisma.guardian.create({ data: { fullName: 'Synthetic Shared Guardian' } });
    await prisma.childGuardian.create({
      data: { childId: fx.child.C6!, guardianId: shared.id, relationship: 'FATHER' },
    });
    const ctx = { userId: fx.user.asha1!, auditDb: prisma };
    await expect(assertInScopeOrDeny(prisma, ctx, 'guardian', shared.id, 'child.read')).rejects.toMatchObject(
      {
        statusCode: 404,
      },
    );
    await prisma.childGuardian.create({
      data: { childId: fx.child.C1!, guardianId: shared.id, relationship: 'FATHER' },
    });
    await assertInScopeOrDeny(prisma, ctx, 'guardian', shared.id, 'child.read');
    await prisma.childGuardian.updateMany({
      where: { childId: fx.child.C1!, guardianId: shared.id, endedAt: null },
      data: { endedAt: clock.now() },
    });
    await expect(assertInScopeOrDeny(prisma, ctx, 'guardian', shared.id, 'child.read')).rejects.toMatchObject(
      {
        statusCode: 404,
      },
    );
  });

  it('denials inside a transaction are still audited (regression: audit was rolled back)', async () => {
    const requestId = `tx-denial-${randomUUID()}`;
    await inRollback(prisma, async (tx) => {
      // Without auditDb the check refuses to run rather than lose the audit row.
      await expect(
        findChildOrDeny(tx, { userId: fx.user.asha1!, requestId }, fx.child.C6!, 'child.read'),
      ).rejects.toThrow(/auditDb is required/);
      await expect(
        findChildOrDeny(
          tx,
          { userId: fx.user.asha1!, requestId, auditDb: prisma },
          fx.child.C6!,
          'child.read',
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
    expect(await prisma.auditLog.count({ where: { requestId, action: 'child.access_denied' } })).toBe(1);
  });
});

// ------------------------------------------------------------------------- data leakage

describe('no leakage through search, filters, pagination, sorting or counts', () => {
  it('searching for an out-of-scope child finds nothing and reports total 0', async () => {
    expect(await childNames('asha1', '?search=Child%20C6')).toEqual({ names: [], total: 0 });
  });

  it('search matches inside scope only', async () => {
    expect(await childNames('asha1', '?search=synthetic')).toEqual({ names: ['C1', 'C2'], total: 2 });
  });

  it('an area filter outside scope yields nothing; a wide filter is still cut to scope', async () => {
    expect(await childNames('asha1', `?areaId=${fx.area.V5}`)).toEqual({ names: [], total: 0 });
    expect(await childNames('asha1', `?areaId=${fx.area.UP}`)).toEqual({ names: ['C1', 'C2'], total: 2 });
    expect(await childNames('sup1', `?areaId=${fx.area.S1}`)).toEqual({
      names: ['C1', 'C2', 'C4'],
      total: 3,
    });
  });

  it('pagination walks only in-scope rows; total is the scoped count', async () => {
    const pages = [];
    for (let page = 1; page <= 3; page += 1)
      pages.push(await childNames('asha1', `?pageSize=1&page=${page}`));
    expect(pages.map((p) => p.names)).toEqual([['C1'], ['C2'], []]);
    expect(pages.every((p) => p.total === 2)).toBe(true);
  });

  it.each(['fullName', '-fullName', 'dateOfBirth', '-dateOfBirth', 'createdAt', '-createdAt'])(
    'sort=%s returns the same in-scope set',
    async (sort) => {
      const { names } = await childNames('sup1', `?sort=${sort}`);
      expect([...names].sort()).toEqual(['C1', 'C2', 'C3', 'C4']);
    },
  );

  it.each(["' OR 1=1 --", '%', '_', '%25', '\\', 'C6" OR "1"="1'])(
    'injection-like search %j stays in scope',
    async (term) => {
      const res = await (
        await as('asha1')
      ).get(`/children?search=${encodeURIComponent(term.padEnd(2, '%'))}`);
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        for (const item of res.body.items as Array<{ id: string }>) {
          expect([fx.child.C1, fx.child.C2]).toContain(item.id);
        }
      }
    },
  );

  it.each(['?userId=x', '?sort=passwordHash', '?pageSize=1000', '?areaId=not-a-uuid', '?include=guardians'])(
    'rejects unexpected or unsafe query %s with 400',
    async (query) => {
      expect((await (await as('asha1')).get(`/children${query}`)).status).toBe(400);
    },
  );

  it('list items contain no guardian, consent or health data (nested leakage)', async () => {
    const res = await (await as('sup1')).get('/children');
    for (const item of res.body.items as object[]) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'areaId',
          'areaName',
          'areaNameHi',
          'dateOfBirth',
          'dobIsEstimated',
          'fullName',
          'id',
          'registeredAt',
          'sexAtBirth',
        ].sort(),
      );
    }
  });
});
