import {
  areaListResponseSchema,
  assignmentListResponseSchema,
  assignmentResponseSchema,
  roleListResponseSchema,
  userListResponseSchema,
  webAuthResponseSchema,
  type AreaListResponse,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { createArea } from '../../src/modules/areas/areaTree';
import { createTestUser, SECOND, testAuthConfig } from './authFixture';
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
 * Admin portal stage PA: GET /api/v1/areas (scoped area tree) and the browser sign-in under
 * /api/v1/auth/web (refresh token in an httpOnly cookie, never in the body).
 */
const ORIGIN = 'http://localhost:8081'; // listed in CORS_ORIGINS by vitest.db.config.mts
const COOKIE = 'bs_admin_rt';

let prisma: PrismaClient;
let fx: AuthzFixture;
let clock: TestClock;
let app: ReturnType<typeof createTestApp>;

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

// ------------------------------------------------------------------------------ areas

async function areas(login: string, query = ''): Promise<{ status: number; body: AreaListResponse }> {
  const res = await api(app, await tokenFor(app, login)).get(`/areas${query}`);
  return { status: res.status, body: res.status === 200 ? areaListResponseSchema.parse(res.body) : res.body };
}
const codes = (body: AreaListResponse) => body.items.map((item) => item.code);

describe('GET /areas - scoped area tree for administration', () => {
  it('state admin: the top area is the state, with its districts as children', async () => {
    const top = await areas('stateadmin');
    expect(top.status).toBe(200);
    expect(codes(top.body)).toEqual(['UP']);
    expect(top.body.items[0]).toMatchObject({ levelCode: 'STATE', childCount: 2, path: [] });

    const districts = await areas('stateadmin', `?parentId=${fx.area.UP}`);
    expect(codes(districts.body)).toEqual(['D1', 'D2']);
  });

  it('district admin: starts at their district, with the state shown only as the path', async () => {
    const top = await areas('dadmin1');
    expect(codes(top.body)).toEqual(['D1']);
    expect(top.body.items[0]!.childCount).toBe(2);
    expect(top.body.items[0]!.path.map((p) => p.id)).toEqual([fx.area.UP]);

    const blocks = await areas('dadmin1', `?parentId=${fx.area.D1}`);
    expect(codes(blocks.body)).toEqual(['B1', 'B2']);
  });

  it('district admin: another district and the state above them look like they do not exist (404)', async () => {
    expect((await areas('dadmin1', `?parentId=${fx.area.D2}`)).status).toBe(404);
    expect((await areas('dadmin1', `?parentId=${fx.area.UP}`)).status).toBe(404);
    expect((await areas('dadmin1', `?parentId=${fx.area.S4}`)).status).toBe(404);
    expect((await areas('dadmin1', '?parentId=00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('search finds only areas in scope, with the full path for display', async () => {
    const found = await areas('dadmin1', '?search=Area%20V');
    expect(codes(found.body)).toEqual(['V1', 'V2', 'V3', 'V4']); // never V5 (district D2)
    const v1 = found.body.items.find((item) => item.code === 'V1')!;
    expect(v1.path.map((p) => p.levelCode)).toEqual(['STATE', 'DISTRICT', 'BLOCK', 'SECTOR']);
    expect(v1.allowsChildRegistration).toBe(true);

    const other = await areas('dadmin2', '?search=Area%20V');
    expect(codes(other.body)).toEqual(['V5']);
  });

  it('a supervisor (assignment.manage over a block subtree) sees that block and below', async () => {
    const top = await areas('sup1');
    expect(codes(top.body)).toEqual(['B1']);
    expect(top.body.items[0]!.childCount).toBe(2);
  });

  it('AREA_ONLY scope: the area itself, without any sub-areas', async () => {
    const top = await areas('sup2');
    expect(codes(top.body)).toEqual(['B1']);
    expect(top.body.items[0]!.childCount).toBe(0);
    const below = await areas('sup2', `?parentId=${fx.area.B1}`);
    expect(below.status).toBe(200);
    expect(below.body.items).toEqual([]);
  });

  it('an ended administrator assignment grants nothing (only the current supervisor scope counts)', async () => {
    expect(codes((await areas('formeradmin')).body)).toEqual(['B1']);
  });

  it('field workers and users without assignments are refused (403) and the refusal is audited', async () => {
    expect((await areas('asha1')).status).toBe(403);
    expect((await areas('noassign')).status).toBe(403);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'authz.denied', actorUserId: fx.user.asha1 },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.details).toMatchObject({ permission: ['user.manage', 'assignment.manage'] });
  });

  it('deactivated areas are not offered', async () => {
    const level = await prisma.areaLevel.findUniqueOrThrow({ where: { code: 'VILLAGE' } });
    const closed = await prisma.$transaction((tx) =>
      createArea(tx, { levelId: level.id, parentId: fx.area.S4!, code: 'V9', nameEn: 'Area V9' }),
    );
    await prisma.area.update({
      where: { id: closed.id },
      data: { isActive: false, deactivatedAt: clock.now() },
    });
    const sector = await areas('dadmin2', `?parentId=${fx.area.S4}`);
    expect(codes(sector.body)).toEqual(['V5']);
    expect(codes((await areas('dadmin2', '?search=V9')).body)).toEqual([]);
  });

  it('rejects mixed or malformed queries with 400', async () => {
    expect((await areas('stateadmin', `?parentId=${fx.area.UP}&search=Area`)).status).toBe(400);
    expect((await areas('stateadmin', '?parentId=not-a-uuid')).status).toBe(400);
    expect((await areas('stateadmin', '?search=a')).status).toBe(400);
    expect((await areas('stateadmin', '?unknown=1')).status).toBe(400);
  });

  it('returns names and levels only - no people, assignments or child data', async () => {
    const res = await api(app, await tokenFor(app, 'stateadmin')).get('/areas?search=Area');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/loginId|displayName|userId|fullName|childId|assignment/i);
  });
});

// ------------------------------------------------------------------------- web sign-in

function web(instance = app) {
  const portal = (r: request.Test) => r.set('Origin', ORIGIN).set('x-balswasthya-client', 'admin-portal');
  return {
    login: (loginId: string, password: string) =>
      portal(request(instance).post('/api/v1/auth/web/login')).send({ loginId, password }),
    refresh: (cookie?: string) => {
      const r = portal(request(instance).post('/api/v1/auth/web/refresh'));
      return cookie ? r.set('Cookie', `${COOKIE}=${cookie}`) : r;
    },
    logout: (cookie: string) =>
      portal(request(instance).post('/api/v1/auth/web/logout')).set('Cookie', `${COOKIE}=${cookie}`),
    changePassword: (token: string, currentPassword: string, newPassword: string) =>
      portal(request(instance).post('/api/v1/auth/web/change-password'))
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword, newPassword }),
  };
}

/** The refresh cookie set by a response: value and raw attributes. */
function sessionCookie(res: request.Response): { value: string; raw: string } | null {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = header?.find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  return { value: decodeURIComponent(raw.slice(COOKIE.length + 1).split(';')[0]!), raw };
}

describe('POST /auth/web/* - admin portal browser sessions', () => {
  it('login sets an httpOnly, SameSite=Strict, path-scoped cookie and never returns the refresh token', async () => {
    const res = await web().login('STATEADMIN', PASSWORD);
    expect(res.status).toBe(200);
    const body = webAuthResponseSchema.strict().parse(res.body);
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');

    const cookie = sessionCookie(res)!;
    expect(cookie.value.length).toBeGreaterThan(20);
    expect(cookie.raw).toContain('HttpOnly');
    expect(cookie.raw).toContain('SameSite=Strict');
    expect(cookie.raw).toContain('Path=/api/v1/auth/web');
    expect(cookie.raw).toContain('Expires=');
    expect(cookie.raw).not.toContain('Secure'); // test environment; production is tested below
    expect(JSON.stringify(res.body)).not.toContain(cookie.value);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.access.permissions).toContain('user.manage');
  });

  it('a wrong password gives the generic 401 and sets no cookie', async () => {
    const res = await web().login('STATEADMIN', 'wrong-password-123');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(sessionCookie(res)).toBeNull();
  });

  it('refresh rotates the cookie; replaying the old one later revokes the whole session', async () => {
    const first = sessionCookie(await web().login('DADMIN1', PASSWORD))!.value;

    const rotated = await web().refresh(first);
    expect(rotated.status).toBe(200);
    expect(rotated.body).not.toHaveProperty('refreshToken');
    const second = sessionCookie(rotated)!.value;
    expect(second).not.toBe(first);

    clock.advance(31 * SECOND); // past the lost-response grace window
    const replay = await web().refresh(first);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_EXPIRED');
    expect(sessionCookie(replay)!.raw).toMatch(new RegExp(`^${COOKIE}=;`)); // cleared

    // Reuse detection revoked the family: the newest cookie is dead too.
    expect((await web().refresh(second)).status).toBe(401);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.refresh_reuse_detected', actorUserId: fx.user.dadmin1 },
    });
    expect(audit).not.toBeNull();
  });

  it('logout revokes the session and clears the cookie', async () => {
    const cookie = sessionCookie(await web().login('DADMIN2', PASSWORD))!.value;
    const out = await web().logout(cookie);
    expect(out.status).toBe(204);
    expect(sessionCookie(out)!.raw).toMatch(new RegExp(`^${COOKIE}=;`));
    expect((await web().refresh(cookie)).status).toBe(401);
  });

  it('change-password replaces the cookie and ends every older session', async () => {
    const user = await createTestUser(prisma, { mustChangePassword: true });
    const login = await web().login(user.loginId, user.password);
    const session = webAuthResponseSchema.parse(login.body);
    expect(session.user.mustChangePassword).toBe(true);
    const oldCookie = sessionCookie(login)!.value;

    const changed = await web().changePassword(session.accessToken, user.password, 'Fresh-Synthetic-2026!');
    expect(changed.status).toBe(200);
    expect(changed.body).not.toHaveProperty('refreshToken');
    expect(changed.body.user.mustChangePassword).toBe(false);
    const newCookie = sessionCookie(changed)!.value;
    expect(newCookie).not.toBe(oldCookie);

    expect((await web().refresh(oldCookie)).status).toBe(401);
    expect((await web().refresh(newCookie)).status).toBe(200);
  });

  it('the mobile refresh endpoint and the web one use the same sessions, but only web uses cookies', async () => {
    // A cookie sent to the mobile endpoint is ignored: it needs the token in the JSON body.
    const cookie = sessionCookie(await web().login('SUP1', PASSWORD))!.value;
    const mobile = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${COOKIE}=${cookie}`)
      .send({});
    expect(mobile.status).toBe(400);
  });

  it('in production settings the cookie is Secure', async () => {
    const prodLike = createApp({
      auth: { db: prisma, config: testAuthConfig, now: clock.now, rateLimits: DEFAULT_RATE_LIMITS },
      webSession: { secureCookie: true, allowedOrigins: [ORIGIN] },
    });
    const res = await web(prodLike).login('SUP2', PASSWORD);
    expect(res.status).toBe(200);
    expect(sessionCookie(res)!.raw).toContain('Secure');
  });

  it('every web sign-in is audited like a normal sign-in', async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login', actorUserId: fx.user.stateadmin, outcome: 'SUCCESS' },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.details)).not.toMatch(/refresh|token|password/i);
  });
});

// ------------------------------------------------------------------- stage PC: user list

describe('GET /users and GET /roles - response contracts used by the portal (stage PC)', () => {
  it('each user row shows only the CURRENT assignments inside the caller’s areas', async () => {
    const res = await api(app, await tokenFor(app, 'dadmin1')).get('/users?pageSize=50');
    expect(res.status).toBe(200);
    const list = userListResponseSchema.parse(res.body);
    const byLogin = new Map(list.items.map((item) => [item.loginId, item]));

    // Works in V1 (district 1) and V5 (district 2): only V1 is shown to district admin 1.
    expect(byLogin.get('ASHABOTH')!.currentAssignments).toEqual([
      { roleCode: 'ASHA', areaName: 'Area V1', areaNameHi: null, status: 'ACTIVE' },
    ]);
    // Suspended assignments are current; revoked and ended ones are not.
    expect(byLogin.get('ASHASUSP')!.currentAssignments).toEqual([
      expect.objectContaining({ status: 'SUSPENDED' }),
    ]);
    expect(byLogin.has('ASHAREVE')).toBe(false);
    expect(byLogin.has('ASHAENDED')).toBe(false);
    // Another district's worker and the caller are not listed at all.
    expect(byLogin.has('ASHA5')).toBe(false);
    expect(byLogin.has('DADMIN1')).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|failedLoginCount|lockedUntil/);
  });

  it('roles parse with the shared contract', async () => {
    const res = await api(app, await tokenFor(app, 'stateadmin')).get('/roles');
    const roles = roleListResponseSchema.parse(res.body).roles;
    expect(roles.map((r) => r.code)).toContain('ASHA');
  });
});

// ------------------------------------------------------------- stage PD: assignment list

describe('GET /assignments - assignments in the caller’s assignment.manage areas (stage PD)', () => {
  async function list(login: string, query = '') {
    const res = await api(app, await tokenFor(app, login)).get(`/assignments${query}`);
    return res;
  }
  const keys = (body: unknown) =>
    assignmentListResponseSchema
      .parse(body)
      .items.map((a) => `${a.user.loginId}@${a.areaName.replace('Area ', '')}`)
      .sort();

  it('a supervisor of block B1 sees the current assignments inside B1 - with names, never their own', async () => {
    const res = await list('sup1', '?pageSize=50');
    expect(res.status).toBe(200);
    expect(keys(res.body)).toEqual(
      [
        'ASHA1@V1',
        'ASHA1@V2',
        'ASHA2@V2',
        'ASHABOTH@V1',
        'ASHAFUTURE@V1',
        'ASHASUSP@V1',
        'AWW1@AWC1',
        'FORMERADMIN@B1',
        'SUP2@B1',
      ].sort(),
    );
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/passwordHash|fullName|childId|guardian/i);
  });

  it('include=all adds ended and revoked assignments; status and search filter', async () => {
    expect(keys((await list('sup1', '?include=all&pageSize=50')).body)).toEqual(
      expect.arrayContaining(['ASHAENDED@V1', 'ASHAREVE@V1']),
    );
    expect(keys((await list('sup1', '?status=SUSPENDED')).body)).toEqual(['ASHASUSP@V1']);
    expect(keys((await list('sup1', '?search=asha1')).body)).toEqual(['ASHA1@V1', 'ASHA1@V2']);
  });

  it('AREA_ONLY scope: only assignments located at that exact area', async () => {
    expect(keys((await list('sup2', '?pageSize=50')).body)).toEqual(['FORMERADMIN@B1', 'SUP1@B1']);
  });

  it('another district is never shown; field workers are refused', async () => {
    const d2 = keys((await list('dadmin2', '?pageSize=50')).body);
    expect(d2).toEqual(['ASHA5@V5', 'ASHABOTH@V5']);
    expect((await list('asha1')).status).toBe(403);
    expect((await list('sup1', '?include=sometimes')).status).toBe(400);
  });

  it('a supervisor can add a field-worker assignment in their block, but not grant a management role', async () => {
    const sup = api(app, await tokenFor(app, 'sup1'));
    const ok = await sup.post('/assignments', {
      userId: fx.user.asha2,
      areaId: fx.area.V3,
      roleId: fx.role.ASHA,
      scope: 'AREA_ONLY',
      reason: 'Covering V3 (synthetic)',
    });
    expect(ok.status).toBe(201);
    assignmentResponseSchema.parse(ok.body);
    const tooHigh = await sup.post('/assignments', {
      userId: fx.user.asha2,
      areaId: fx.area.V3,
      roleId: fx.role.DISTRICT_ADMIN,
      scope: 'AREA_ONLY',
      reason: 'Escalation attempt (synthetic)',
    });
    expect(tooHigh.status).toBe(403);
  });
});
