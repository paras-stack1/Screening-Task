import { Router } from 'express';
import { createDataRateLimiters } from '../middleware/rateLimit';
import { createAuthRouter, type AuthRouterDependencies } from '../modules/auth/auth.routes';
import { createChildrenRouter } from '../modules/children/children.routes';
import { createChildConsentsRouter, createConsentNoticesRouter } from '../modules/consent/consent.routes';
import type { ConsentPolicySettings } from '../modules/consent/consentPolicy';
import { createGuardiansRouter } from '../modules/guardians/guardians.routes';
import type { ScreeningPolicySettings } from '../modules/screening/protocolSelection';
import {
  createScreeningEligibilityRouter,
  createScreeningProtocolsRouter,
} from '../modules/screening/protocols.routes';
import { createChildScreeningsRouter, createScreeningsRouter } from '../modules/screening/screenings.routes';
import { createAssignmentsRouter, createRolesRouter, createUsersRouter } from '../modules/users/users.routes';
import type { PiiCrypto } from '../utils/piiCrypto';
import { createHealthRouter, type HealthDependencies } from './health.routes';

export interface ApiRouterDependencies {
  health: HealthDependencies;
  /** Database, auth settings and clock shared by every protected module. */
  auth: AuthRouterDependencies;
  /** Guardian phone encryption (keys from the secret manager). */
  pii: PiiCrypto;
  /** Consent rules that depend on the environment (draft notices outside production only). */
  consentPolicy: ConsentPolicySettings;
  /** Screening content rules that depend on the environment (draft protocols outside production only). */
  screeningPolicy: ScreeningPolicySettings;
}

/**
 * Versioned API router mounted at /api/v1. Each feature module exports its own router factory
 * and is registered here.
 *
 * PUBLIC routes (no access token): /health/*, /auth/login, /auth/refresh, /auth/logout.
 * Every other route authenticates first and then checks a permission; the route inventory in
 * tests/apiSecurity.test.ts fails if a new route is reachable without a token.
 */
export function createApiRouter(deps: ApiRouterDependencies): Router {
  const router = Router();
  // One limiter for all child data, so children, guardian and consent routes share the budget.
  const childData = {
    ...deps.auth,
    pii: deps.pii,
    consentPolicy: deps.consentPolicy,
    screeningPolicy: deps.screeningPolicy,
    dataRateLimit: createDataRateLimiters(deps.auth.rateLimits),
  };
  router.use('/health', createHealthRouter(deps.health));
  router.use('/auth', createAuthRouter(deps.auth));
  router.use('/consent-notices', createConsentNoticesRouter(childData));
  // Before '/children' so the nested consent and screening routes are matched first.
  router.use('/children/:childId/consents', createChildConsentsRouter(childData));
  router.use('/children/:childId/screening-eligibility', createScreeningEligibilityRouter(childData));
  router.use('/children/:childId/screenings', createChildScreeningsRouter(childData));
  router.use('/screening-protocols', createScreeningProtocolsRouter(childData));
  router.use('/screenings', createScreeningsRouter(childData));
  router.use('/children', createChildrenRouter(childData));
  router.use('/guardians', createGuardiansRouter(childData));
  router.use('/users', createUsersRouter(deps.auth));
  router.use('/assignments', createAssignmentsRouter(deps.auth));
  router.use('/roles', createRolesRouter(deps.auth));
  return router;
}
