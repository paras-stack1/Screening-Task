import {
  healthResponseSchema,
  readinessResponseSchema,
  type DependencyStatus,
} from '@balswasthya/shared-contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createReadinessCheck, READINESS_CACHE_TTL_MS } from '../src/routes/health.routes';

function appWith(database: boolean | Error, aiService: DependencyStatus) {
  return createApp({
    health: {
      checkDatabase: () => (database instanceof Error ? Promise.reject(database) : Promise.resolve(database)),
      checkAiService: () => Promise.resolve(aiService),
    },
  });
}

describe('GET /api/v1/health (liveness)', () => {
  it('returns 200 with the shared contract shape', async () => {
    const res = await request(appWith(true, 'up')).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(healthResponseSchema.safeParse(res.body).success).toBe(true);
  });
});

describe('GET /api/v1/health/ready (readiness)', () => {
  it.each([
    { db: true, ai: 'up', status: 200, overall: 'ready' },
    { db: true, ai: 'not_configured', status: 200, overall: 'ready' },
    { db: true, ai: 'down', status: 200, overall: 'degraded' },
    { db: false, ai: 'up', status: 503, overall: 'unavailable' },
  ] as const)('database=$db, ai=$ai -> $status $overall', async ({ db, ai, status, overall }) => {
    const res = await request(appWith(db, ai)).get('/api/v1/health/ready');
    expect(res.status).toBe(status);
    expect(readinessResponseSchema.parse(res.body).status).toBe(overall);
  });

  it('treats a throwing database check as down instead of crashing', async () => {
    const res = await request(appWith(new Error('connection refused'), 'up')).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'unavailable', dependencies: { database: 'down' } });
  });
});

describe('createReadinessCheck caching', () => {
  function countingDeps() {
    const calls = { db: 0, ai: 0 };
    return {
      calls,
      deps: {
        checkDatabase: () => {
          calls.db += 1;
          return Promise.resolve(true);
        },
        checkAiService: (): Promise<DependencyStatus> => {
          calls.ai += 1;
          return Promise.resolve('up');
        },
      },
    };
  }

  it('reuses the result within the TTL and refreshes after it', async () => {
    let clock = 0;
    const { calls, deps } = countingDeps();
    const check = createReadinessCheck(deps, READINESS_CACHE_TTL_MS, () => clock);

    await check();
    clock = READINESS_CACHE_TTL_MS - 1;
    await check();
    expect(calls).toEqual({ db: 1, ai: 1 });

    clock = READINESS_CACHE_TTL_MS;
    await check();
    expect(calls).toEqual({ db: 2, ai: 2 });
  });

  it('shares one in-flight check between concurrent callers', async () => {
    const { calls, deps } = countingDeps();
    const check = createReadinessCheck(deps, READINESS_CACHE_TTL_MS, () => 0);
    await Promise.all([check(), check(), check()]);
    expect(calls).toEqual({ db: 1, ai: 1 });
  });
});
