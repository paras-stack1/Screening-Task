import type { PrismaClient, UserStatus } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import type { AuthConfig } from '../../src/config/security';
import { DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimit';
import { hashPassword } from '../../src/utils/password';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const DAY = 24 * 60 * MINUTE;

/** Synthetic auth settings for tests (real defaults: 15 min access, 14 d idle, 30 d absolute). */
export const testAuthConfig: AuthConfig = {
  jwt: {
    secret: new TextEncoder().encode('db-test-only-jwt-secret-0123456789abcdef'),
    issuer: 'balswasthya-api:test',
    audience: 'balswasthya-worker-app',
    accessTokenTtlSeconds: 900,
  },
  refresh: { idleTtlMs: 14 * DAY, absoluteTtlMs: 30 * DAY, reuseGraceMs: 30_000 },
  login: { maxFailedAttempts: 5, lockoutBaseMs: 60_000, lockoutMaxMs: 15 * 60_000 },
};

/** A controllable clock shared by the API and the test. */
export class TestClock {
  constructor(private current = new Date('2026-11-21T09:00:00.000Z')) {}
  now = () => new Date(this.current);
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** A fresh app (fresh rate-limit counters) on the test database with the test clock. */
export function createTestApp(db: PrismaClient, clock: TestClock, config: AuthConfig = testAuthConfig) {
  return createApp({
    auth: {
      db,
      config,
      now: clock.now,
      // High limits: these tests exercise auth logic; rate limits are tested separately.
      rateLimits: { ...DEFAULT_RATE_LIMITS, loginPerIpAndAccount: 1000, loginPerIp: 1000 },
    },
  });
}

let counter = 0;

export async function createTestUser(
  db: PrismaClient,
  options: { password?: string; status?: UserStatus; mustChangePassword?: boolean } = {},
) {
  counter += 1;
  const password = options.password ?? `Synthetic-pass-${counter}`;
  const user = await db.user.create({
    data: {
      loginId: `EMP-${String(counter).padStart(4, '0')}-${Date.now() % 100000}`,
      passwordHash: await hashPassword(password),
      displayName: `Synthetic Worker ${counter}`,
      status: options.status ?? 'ACTIVE',
      mustChangePassword: options.mustChangePassword ?? false,
    },
  });
  return { ...user, password };
}

export type TestApp = ReturnType<typeof createTestApp>;

export function login(app: TestApp, loginId: string, password: string, deviceLabel?: string) {
  return request(app)
    .post('/api/v1/auth/login')
    .send({ loginId, password, ...(deviceLabel && { deviceLabel }) });
}

export function refresh(app: TestApp, refreshToken: string) {
  return request(app).post('/api/v1/auth/refresh').send({ refreshToken });
}

export function me(app: TestApp, accessToken: string) {
  return request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
}
