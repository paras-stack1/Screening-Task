import type { HealthResponse, ReadinessResponse } from '@balswasthya/shared-contracts';
import { Router } from 'express';
import { isDatabaseReachable } from '../config/database';
import { getAiServiceStatus } from '../integrations/ai-service/aiServiceClient';

const SERVICE_NAME = 'balswasthya-api';
const SERVICE_VERSION = process.env.npm_package_version ?? '0.1.0';

export const healthRouter = Router();

/** Liveness: the process is up. Does not touch the database. */
healthRouter.get('/', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };
  res.json(body);
});

/**
 * Readiness: can we serve real traffic?
 *  - Database down  -> 503 "unavailable"
 *  - AI service down -> 200 "degraded" (screening still works without AI)
 */
healthRouter.get('/ready', async (_req, res) => {
  const [databaseUp, aiService] = await Promise.all([isDatabaseReachable(), getAiServiceStatus()]);

  const status: ReadinessResponse['status'] = !databaseUp
    ? 'unavailable'
    : aiService === 'down'
      ? 'degraded'
      : 'ready';

  const body: ReadinessResponse = {
    status,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    dependencies: {
      database: databaseUp ? 'up' : 'down',
      aiService,
    },
  };
  res.status(databaseUp ? 200 : 503).json(body);
});
