import type { DependencyStatus, HealthResponse, ReadinessResponse } from '@balswasthya/shared-contracts';
import { Router } from 'express';

const SERVICE_NAME = 'balswasthya-api';
const SERVICE_VERSION = process.env.npm_package_version ?? '0.1.0';

/**
 * How long a readiness result is reused. The endpoint is public and each fresh
 * check runs a DB query plus an outbound AI call, so caching stops it being used
 * to generate load on those dependencies.
 */
export const READINESS_CACHE_TTL_MS = 5_000;

export interface HealthDependencies {
  checkDatabase: () => Promise<boolean>;
  checkAiService: () => Promise<DependencyStatus>;
}

/** Returns a readiness function that caches its result (and in-flight check) for `ttlMs`. */
export function createReadinessCheck(
  deps: HealthDependencies,
  ttlMs = READINESS_CACHE_TTL_MS,
  now: () => number = Date.now,
): () => Promise<ReadinessResponse> {
  let cached: { at: number; result: Promise<ReadinessResponse> } | undefined;

  async function compute(): Promise<ReadinessResponse> {
    const [databaseUp, aiService] = await Promise.all([
      deps.checkDatabase().catch(() => false),
      deps.checkAiService().catch((): DependencyStatus => 'down'),
    ]);

    // Database down -> unavailable. AI down -> degraded (screening still works without AI).
    const status: ReadinessResponse['status'] = !databaseUp
      ? 'unavailable'
      : aiService === 'down'
        ? 'degraded'
        : 'ready';

    return {
      status,
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      dependencies: { database: databaseUp ? 'up' : 'down', aiService },
    };
  }

  return () => {
    const at = now();
    if (cached && at - cached.at < ttlMs) return cached.result;
    const result = compute();
    cached = { at, result };
    return result;
  };
}

export function createHealthRouter(deps: HealthDependencies): Router {
  const router = Router();
  const checkReadiness = createReadinessCheck(deps);

  /** Liveness: the process is up. Does not touch the database. */
  router.get('/', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
    res.json(body);
  });

  /** Readiness: can we serve real traffic? Database down -> 503. */
  router.get('/ready', async (_req, res) => {
    const body = await checkReadiness();
    res.status(body.dependencies.database === 'up' ? 200 : 503).json(body);
  });

  return router;
}
