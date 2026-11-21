import { authTokensResponseSchema } from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INVALID_CREDENTIALS_MESSAGE } from '../../src/modules/auth/auth.service';
import { hashRefreshToken } from '../../src/utils/token';
import {
  createTestApp,
  createTestUser,
  DAY,
  login,
  me,
  MINUTE,
  refresh,
  SECOND,
  testAuthConfig,
  TestClock,
  type TestApp,
} from './authFixture';
import { createTestPrisma, resetData } from './testDatabase';

/** Authentication, JWT and session lifecycle against the real migrated schema. */
let prisma: PrismaClient;
let clock: TestClock;
let app: TestApp;

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  clock = new TestClock();
  app = createTestApp(prisma, clock);
});

async function signIn(user: { loginId: string; password: string }, device?: string) {
  const res = await login(app, user.loginId, user.password, device);
  expect(res.status).toBe(200);
  return authTokensResponseSchema.parse(res.body);
}

const auditRows = (action: string, entityId?: string) =>
  prisma.auditLog.findMany({
    where: { action, ...(entityId && { entityId }) },
    orderBy: { occurredAt: 'asc' },
  });

// ---------------------------------------------------------------------------------- login

describe('login', () => {
  it('returns access + refresh tokens and the public user profile only', async () => {
    const user = await createTestUser(prisma);
    const res = await login(app, user.loginId, user.password, 'Android phone');

    expect(res.status).toBe(200);
    const body = authTokensResponseSchema.parse(res.body);
    expect(body.user).toEqual({
      id: user.id,
      displayName: user.displayName,
      preferredLanguage: 'hi',
      mustChangePassword: false,
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('$argon2');
    expect(text).not.toContain(user.password);
  });

  it('stores only the SHA-256 hash of the refresh token, with the device label', async () => {
    const user = await createTestUser(prisma);
    const body = await signIn(user, 'Android phone');
    const rows = await prisma.refreshSession.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashRefreshToken(body.refreshToken));
    expect(rows[0]!.tokenHash).not.toBe(body.refreshToken);
    expect(rows[0]!.deviceLabel).toBe('Android phone');
  });

  it('normalises the login ID (spaces and case)', async () => {
    const user = await createTestUser(prisma);
    const res = await login(app, `  ${user.loginId.toLowerCase()} `, user.password);
    expect(res.status).toBe(200);
  });

  it('records last login, resets the failure counter, and audits success', async () => {
    const user = await createTestUser(prisma);
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 3 } });
    await signIn(user);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.failedLoginCount).toBe(0);
    expect(saved.lastLoginAt?.toISOString()).toBe(clock.now().toISOString());
    const audit = await auditRows('auth.login', user.id);
    expect(audit.at(-1)).toMatchObject({ outcome: 'SUCCESS', actorUserId: user.id });
  });

  describe('generic failure: identical response for every reason', () => {
    async function failure(loginId: string, password: string) {
      const res = await login(app, loginId, password);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: INVALID_CREDENTIALS_MESSAGE,
      });
      return { code: res.body.error.code as string, message: res.body.error.message as string };
    }

    it('wrong password, unknown account, suspended and deactivated accounts look the same', async () => {
      const active = await createTestUser(prisma);
      const suspended = await createTestUser(prisma, { status: 'SUSPENDED' });
      const deactivated = await createTestUser(prisma, { status: 'DEACTIVATED' });

      const results = [
        await failure(active.loginId, 'wrong-password-1'),
        await failure('EMP-DOES-NOT-EXIST', 'whatever-password'),
        await failure(suspended.loginId, suspended.password), // correct password, inactive account
        await failure(deactivated.loginId, deactivated.password),
      ];
      expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);

      // No session was created for the inactive accounts.
      expect(
        await prisma.refreshSession.count({ where: { userId: { in: [suspended.id, deactivated.id] } } }),
      ).toBe(0);
    });

    it('audits failures with a reason code and never the password', async () => {
      const user = await createTestUser(prisma);
      await failure(user.loginId, 'Wrong-Secret-xyz');
      const row = (await auditRows('auth.login', user.id)).at(-1)!;
      expect(row.outcome).toBe('FAILED');
      expect(row.details).toEqual({ reason: 'BAD_PASSWORD' });
      expect(JSON.stringify(row)).not.toContain('Wrong-Secret-xyz');

      await failure('EMP-UNKNOWN-1', 'Another-Secret-xyz');
      const unknown = (await auditRows('auth.login')).at(-1)!;
      expect(unknown).toMatchObject({
        outcome: 'FAILED',
        actorUserId: null,
        details: { reason: 'UNKNOWN_ACCOUNT' },
      });
      expect(JSON.stringify(unknown)).not.toContain('Another-Secret-xyz');
      expect(JSON.stringify(unknown)).not.toContain('EMP-UNKNOWN-1');
    });
  });

  describe('temporary lockout (never permanent)', () => {
    it('locks after 5 failures, refuses even the right password, then unlocks', async () => {
      const user = await createTestUser(prisma);
      for (let i = 0; i < 5; i += 1) {
        expect((await login(app, user.loginId, `wrong-${i}-password`)).status).toBe(401);
      }
      const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(locked.lockedUntil?.getTime()).toBe(clock.now().getTime() + MINUTE);

      expect((await login(app, user.loginId, user.password)).status).toBe(401);

      clock.advance(MINUTE + SECOND);
      expect((await login(app, user.loginId, user.password)).status).toBe(200);
      const unlocked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(unlocked).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    });

    it('does not extend the lock while it is active (third parties cannot keep a user locked)', async () => {
      const user = await createTestUser(prisma);
      for (let i = 0; i < 5; i += 1) await login(app, user.loginId, `wrong-${i}-password`);
      const { lockedUntil } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      for (let i = 0; i < 5; i += 1) await login(app, user.loginId, 'still-wrong-password');
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.lockedUntil).toEqual(lockedUntil);
      expect(after.failedLoginCount).toBe(5);
    });

    it('doubles the lock on further failures, capped at 15 minutes', async () => {
      const user = await createTestUser(prisma);
      const lockDurations: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        await login(app, user.loginId, `wrong-${i}-password`);
        const { lockedUntil } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        if (lockedUntil && lockedUntil > clock.now()) {
          lockDurations.push(lockedUntil.getTime() - clock.now().getTime());
          clock.advance(lockedUntil.getTime() - clock.now().getTime() + SECOND);
        }
      }
      expect(lockDurations).toEqual([1, 2, 4, 8, 15, 15].map((m) => m * MINUTE));
    });
  });
});

// ------------------------------------------------------------------- access-token checks

describe('access tokens on protected routes', () => {
  it('a valid token reaches the route', async () => {
    const user = await createTestUser(prisma);
    const { accessToken } = await signIn(user);
    const res = await me(app, accessToken);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
  });

  it('expires after 15 minutes', async () => {
    const user = await createTestUser(prisma);
    const { accessToken } = await signIn(user);
    clock.advance(15 * MINUTE + 6 * SECOND);
    expect((await me(app, accessToken)).status).toBe(401);
  });

  it('is rejected by an API configured for another environment (issuer)', async () => {
    const user = await createTestUser(prisma);
    const { accessToken } = await signIn(user);
    const otherEnv = createTestApp(prisma, clock, {
      ...testAuthConfig,
      jwt: { ...testAuthConfig.jwt, issuer: 'balswasthya-api:production' },
    });
    expect((await me(otherEnv, accessToken)).status).toBe(401);
  });

  it('stops working immediately when the account is suspended (claims are not trusted alone)', async () => {
    const user = await createTestUser(prisma);
    const { accessToken } = await signIn(user);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    expect((await me(app, accessToken)).status).toBe(401);
  });

  it('stops working immediately after logout', async () => {
    const user = await createTestUser(prisma);
    const { accessToken, refreshToken } = await signIn(user);
    expect((await request(app).post('/api/v1/auth/logout').send({ refreshToken })).status).toBe(204);
    expect((await me(app, accessToken)).status).toBe(401);
  });

  it('mustChangePassword: only me, change-password and logout-all are allowed', async () => {
    const user = await createTestUser(prisma, { mustChangePassword: true });
    const { accessToken, user: profile } = await signIn(user);
    expect(profile.mustChangePassword).toBe(true);
    expect((await me(app, accessToken)).status).toBe(200);
    const sessions = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(sessions.status).toBe(403);
    expect(sessions.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

// ------------------------------------------------------------------------------ refresh

describe('refresh-token rotation', () => {
  it('rotates: new token pair, old row marked ROTATED and linked to its replacement', async () => {
    const user = await createTestUser(prisma);
    const first = await signIn(user);
    clock.advance(10 * MINUTE);

    const res = await refresh(app, first.refreshToken);
    expect(res.status).toBe(200);
    const second = authTokensResponseSchema.parse(res.body);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);

    const old = await prisma.refreshSession.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(first.refreshToken) },
    });
    const next = await prisma.refreshSession.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(second.refreshToken) },
    });
    expect(old).toMatchObject({ revokedReason: 'ROTATED', replacedById: next.id, familyId: next.familyId });
    expect(next.revokedAt).toBeNull();
    expect((await me(app, second.accessToken)).status).toBe(200);
  });

  it('rejects an unknown token with a generic 401', async () => {
    const res = await refresh(app, 'not-a-real-refresh-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('expires after 14 days without use', async () => {
    const user = await createTestUser(prisma);
    const { refreshToken } = await signIn(user);
    clock.advance(14 * DAY + SECOND);
    expect((await refresh(app, refreshToken)).status).toBe(401);
  });

  it('enforces the 30-day absolute limit even when refreshed regularly', async () => {
    const user = await createTestUser(prisma);
    const start = clock.now().getTime();
    let { refreshToken } = await signIn(user);
    for (const day of [13, 26, 29]) {
      clock.advance(day * DAY - (clock.now().getTime() - start));
      const res = await refresh(app, refreshToken);
      expect(res.status).toBe(200);
      refreshToken = res.body.refreshToken as string;
      expect(new Date(res.body.refreshTokenExpiresAt as string).getTime()).toBeLessThanOrEqual(
        start + 30 * DAY,
      );
    }
    clock.advance(start + 30 * DAY + SECOND - clock.now().getTime());
    expect((await refresh(app, refreshToken)).status).toBe(401);
  });

  describe('reuse detection', () => {
    it('replay of a rotated token after the grace window revokes the whole family', async () => {
      const user = await createTestUser(prisma);
      const first = await signIn(user);
      const second = authTokensResponseSchema.parse((await refresh(app, first.refreshToken)).body);

      clock.advance(31 * SECOND);
      const replay = await refresh(app, first.refreshToken);
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('SESSION_EXPIRED');
      expect(JSON.stringify(replay.body)).not.toMatch(/reuse|theft|family/i);

      // The legitimate holder's newer tokens are dead too: the user must sign in again.
      expect((await refresh(app, second.refreshToken)).status).toBe(401);
      expect((await me(app, second.accessToken)).status).toBe(401);

      const family = await prisma.refreshSession.findMany({ where: { userId: user.id } });
      expect(family.every((row) => row.revokedAt !== null)).toBe(true);
      const audit = await auditRows('auth.refresh_reuse_detected', family[0]!.familyId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ outcome: 'DENIED', actorUserId: user.id });
    });

    it('replay of a token whose replacement was already used is theft even inside the grace window', async () => {
      const user = await createTestUser(prisma);
      const first = await signIn(user);
      const second = authTokensResponseSchema.parse((await refresh(app, first.refreshToken)).body);
      clock.advance(5 * SECOND);
      expect((await refresh(app, second.refreshToken)).status).toBe(200); // replacement used
      clock.advance(5 * SECOND);
      expect((await refresh(app, first.refreshToken)).status).toBe(401);
      expect(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    });

    it('lost response (decision B): the same token retried within 30 s gets a new pair, once', async () => {
      const user = await createTestUser(prisma);
      const first = await signIn(user);
      const lost = authTokensResponseSchema.parse((await refresh(app, first.refreshToken)).body);
      clock.advance(10 * SECOND);

      const retry = await refresh(app, first.refreshToken);
      expect(retry.status).toBe(200);
      const kept = authTokensResponseSchema.parse(retry.body);

      // Exactly one current token in the family: the retried one. The lost one is superseded.
      const active = await prisma.refreshSession.findMany({ where: { userId: user.id, revokedAt: null } });
      expect(active.map((row) => row.tokenHash)).toEqual([hashRefreshToken(kept.refreshToken)]);
      expect((await refresh(app, kept.refreshToken)).status).toBe(200);

      // If the "lost" token surfaces later, that is reuse: the family is revoked.
      clock.advance(SECOND);
      expect((await refresh(app, lost.refreshToken)).status).toBe(401);
      expect(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    });
  });

  it('concurrent duplicate refreshes never leave two valid sessions', async () => {
    const user = await createTestUser(prisma);
    const { refreshToken } = await signIn(user);

    const responses = await Promise.all(Array.from({ length: 5 }, () => refresh(app, refreshToken)));
    const succeeded = responses.filter((r) => r.status === 200);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(responses.every((r) => r.status === 200 || r.status === 401)).toBe(true);

    const active = await prisma.refreshSession.findMany({ where: { userId: user.id, revokedAt: null } });
    expect(active).toHaveLength(1);
    // Exactly one returned token is the current one; the family was not revoked.
    const returnedHashes = succeeded.map((r) => hashRefreshToken(r.body.refreshToken as string));
    expect(returnedHashes.filter((h) => h === active[0]!.tokenHash)).toHaveLength(1);
    expect(await auditRows('auth.refresh_reuse_detected', active[0]!.familyId)).toHaveLength(0);
  });

  it('is refused after the account is suspended, and the session is revoked and audited', async () => {
    const user = await createTestUser(prisma);
    const { refreshToken } = await signIn(user);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    expect((await refresh(app, refreshToken)).status).toBe(401);
    expect(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    const row = await prisma.refreshSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.revokedReason).toBe('ACCOUNT_INACTIVE');

    // Reactivation does not resurrect the revoked session.
    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    expect((await refresh(app, refreshToken)).status).toBe(401);
  });

  it('is refused after logout, without being treated as theft', async () => {
    const user = await createTestUser(prisma);
    const { refreshToken } = await signIn(user);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect((await refresh(app, refreshToken)).status).toBe(401);
    const row = await prisma.refreshSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.revokedReason).toBe('LOGOUT');
  });
});

// ------------------------------------------------------------------- sessions and logout

describe('logout and session management', () => {
  it('logout is idempotent and does not reveal whether a token existed', async () => {
    const user = await createTestUser(prisma);
    const { refreshToken } = await signIn(user);
    for (const token of [refreshToken, refreshToken, 'never-issued-token']) {
      expect((await request(app).post('/api/v1/auth/logout').send({ refreshToken: token })).status).toBe(204);
    }
    // AuditLog is append-only and never reset between runs: count this user's rows only.
    expect(await prisma.auditLog.count({ where: { action: 'auth.logout', actorUserId: user.id } })).toBe(1);
  });

  it('logout on one device leaves other devices signed in', async () => {
    const user = await createTestUser(prisma);
    const phone = await signIn(user, 'Phone');
    const tablet = await signIn(user, 'Tablet');
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: phone.refreshToken });
    expect((await me(app, phone.accessToken)).status).toBe(401);
    expect((await me(app, tablet.accessToken)).status).toBe(200);
  });

  it('logout-all ends every session of the user', async () => {
    const user = await createTestUser(prisma);
    const phone = await signIn(user, 'Phone');
    const tablet = await signIn(user, 'Tablet');
    const res = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${phone.accessToken}`);
    expect(res.status).toBe(204);
    for (const s of [phone, tablet]) {
      expect((await me(app, s.accessToken)).status).toBe(401);
      expect((await refresh(app, s.refreshToken)).status).toBe(401);
    }
  });

  it("lists own sessions and revokes one of them; another user's session id gives 404", async () => {
    const user = await createTestUser(prisma);
    const other = await createTestUser(prisma);
    const phone = await signIn(user, 'Phone');
    const tablet = await signIn(user, 'Tablet');
    const otherSession = await signIn(other, 'Other phone');

    const list = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${phone.accessToken}`);
    expect(list.status).toBe(200);
    const sessions = list.body.sessions as Array<{
      sessionId: string;
      deviceLabel: string;
      current: boolean;
    }>;
    expect(sessions.map((s) => s.deviceLabel).sort()).toEqual(['Phone', 'Tablet']);
    expect(sessions.filter((s) => s.current).map((s) => s.deviceLabel)).toEqual(['Phone']);

    const otherFamily = (await prisma.refreshSession.findFirstOrThrow({ where: { userId: other.id } }))
      .familyId;
    const idor = await request(app)
      .delete(`/api/v1/auth/sessions/${otherFamily}`)
      .set('Authorization', `Bearer ${phone.accessToken}`);
    expect(idor.status).toBe(404);
    expect((await me(app, otherSession.accessToken)).status).toBe(200);

    const tabletId = sessions.find((s) => s.deviceLabel === 'Tablet')!.sessionId;
    const revoke = await request(app)
      .delete(`/api/v1/auth/sessions/${tabletId}`)
      .set('Authorization', `Bearer ${phone.accessToken}`);
    expect(revoke.status).toBe(204);
    expect((await refresh(app, tablet.refreshToken)).status).toBe(401);
    expect((await me(app, phone.accessToken)).status).toBe(200);
  });
});

// ------------------------------------------------------------------------ password change

describe('password change', () => {
  const change = (accessToken: string, currentPassword: string, newPassword: string) =>
    request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword, newPassword });

  it('rejects a wrong current password (audited) and policy violations', async () => {
    const user = await createTestUser(prisma);
    const { accessToken } = await signIn(user);

    const wrong = await change(accessToken, 'not-my-password', 'A-good-new-password');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect((await auditRows('auth.password_change', user.id)).at(-1)?.outcome).toBe('FAILED');

    for (const [newPassword, rule] of [
      ['short', 'TOO_SHORT'],
      ['password123', 'TOO_COMMON'],
      [`x-${user.loginId}-x`, 'CONTAINS_LOGIN_ID'],
      [user.password, 'SAME_AS_CURRENT'],
    ]) {
      const res = await change(accessToken, user.password, newPassword!);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'PASSWORD_POLICY', details: { rule } });
    }
  });

  it('changes the password, revokes every session, and starts a new one for this device', async () => {
    const user = await createTestUser(prisma, { mustChangePassword: true });
    const phone = await signIn(user, 'Phone');
    const tablet = await signIn(user, 'Tablet');

    const res = await change(phone.accessToken, user.password, 'A-brand-new-passphrase');
    expect(res.status).toBe(200);
    const fresh = authTokensResponseSchema.parse(res.body);
    expect(fresh.user.mustChangePassword).toBe(false);

    // Every earlier token, on every device, is dead.
    for (const s of [phone, tablet]) {
      expect((await me(app, s.accessToken)).status).toBe(401);
      expect((await refresh(app, s.refreshToken)).status).toBe(401);
    }
    // The new session works and keeps this device's label.
    expect((await me(app, fresh.accessToken)).status).toBe(200);
    const current = await prisma.refreshSession.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(fresh.refreshToken) },
    });
    expect(current.deviceLabel).toBe('Phone');

    expect((await login(app, user.loginId, user.password)).status).toBe(401);
    expect((await login(app, user.loginId, 'A-brand-new-passphrase')).status).toBe(200);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.passwordChangedAt?.toISOString()).toBe(clock.now().toISOString());
    expect((await auditRows('auth.password_change', user.id)).at(-1)?.outcome).toBe('SUCCESS');
  });
});
