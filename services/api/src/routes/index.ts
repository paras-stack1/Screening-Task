import { Router } from 'express';
import { createAuthRouter, type AuthRouterDependencies } from '../modules/auth/auth.routes';
import { createChildrenRouter } from '../modules/children/children.routes';
import { createAssignmentsRouter, createRolesRouter, createUsersRouter } from '../modules/users/users.routes';
import { createHealthRouter, type HealthDependencies } from './health.routes';

export interface ApiRouterDependencies {
  health: HealthDependencies;
  /** Database, auth settings and clock shared by every protected module. */
  auth: AuthRouterDependencies;
}

/**
 * Versioned API router mounted at /api/v1. Each feature module exports its own router factory
 * and is registered here.
 *
 * PUBLIC routes (no access token): /health/*, /auth/login, /auth/refresh, /auth/logout.
 * Every other route authenticates first and then checks a permission; tests/routeInventory
 * fails if a new route is reachable without a token.
 */
export function createApiRouter(deps: ApiRouterDependencies): Router {
  const router = Router();
  router.use('/health', createHealthRouter(deps.health));
  router.use('/auth', createAuthRouter(deps.auth));
  router.use('/children', createChildrenRouter(deps.auth));
  router.use('/users', createUsersRouter(deps.auth));
  router.use('/assignments', createAssignmentsRouter(deps.auth));
  router.use('/roles', createRolesRouter(deps.auth));
  return router;
}
