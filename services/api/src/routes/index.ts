import { Router } from 'express';
import { createHealthRouter, type HealthDependencies } from './health.routes';

export interface ApiRouterDependencies {
  health: HealthDependencies;
}

/**
 * Versioned API router mounted at /api/v1.
 * Each feature module will export its own router and be registered here, e.g.
 *   router.use('/auth', authRouter);
 *   router.use('/children', childrenRouter);
 */
export function createApiRouter(deps: ApiRouterDependencies): Router {
  const router = Router();
  router.use('/health', createHealthRouter(deps.health));
  return router;
}
