import { Router } from 'express';
import { createDataRateLimiters } from '../middleware/rateLimit';
import { createAreasRouter } from '../modules/areas/areas.routes';
import { createAuthRouter, type AuthRouterDependencies } from '../modules/auth/auth.routes';
import { createWebAuthRouter, type WebSessionSettings } from '../modules/auth/webAuth.routes';
import { createChildrenRouter } from '../modules/children/children.routes';
import {
  createClinicalRuleSetsRouter,
  createScreeningResultsRouter,
} from '../modules/clinical-rules/results.routes';
import { createChildConsentsRouter, createConsentNoticesRouter } from '../modules/consent/consent.routes';
import type { ConsentPolicySettings } from '../modules/consent/consentPolicy';
import {
  createDashboardsRouter,
  createFollowUpsRouter,
  createNotificationsRouter,
  createReportsRouter,
} from '../modules/follow-ups/followUps.routes';
import { createGuardiansRouter } from '../modules/guardians/guardians.routes';
import { createGuardianInvitationsRouter } from '../modules/parent-portal/invitations.routes';
import type { ParentPortalSettings } from '../modules/parent-portal/invitations.service';
import { createParentOnboardingRouter } from '../modules/parent-portal/onboarding.routes';
import {
  createClinicalReviewsRouter,
  createFacilitiesRouter,
  createReferralsRouter,
} from '../modules/referrals/referrals.routes';
import type { ScreeningPolicySettings } from '../modules/screening/protocolSelection';
import {
  createScreeningEligibilityRouter,
  createScreeningProtocolsRouter,
} from '../modules/screening/protocols.routes';
import {
  createAmendmentQueueRouter,
  createChildScreeningsRouter,
  createScreeningsRouter,
} from '../modules/screening/screenings.routes';
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
  /** Admin portal browser sessions (refresh token in an httpOnly cookie; secure in production). */
  webSession: WebSessionSettings;
  /** Parent Portal onboarding (Step 8): trusted portal address, invitation lifetime, SMS sender. */
  parentPortal: ParentPortalSettings;
}

/**
 * Versioned API router mounted at /api/v1. Each feature module exports its own router factory
 * and is registered here.
 *
 * PUBLIC routes (no access token): /health/*, /auth/login, /auth/refresh, /auth/logout, and the
 * admin portal's /auth/web/login, /auth/web/refresh, /auth/web/logout (listed origin + portal
 * header required; the refresh token is an httpOnly cookie), and the Parent Portal onboarding
 * routes under /parent (authorised by the invitation token and a verified code; Step 8).
 * Every other route authenticates first and then checks a permission. The route inventory in
 * tests/apiSecurity.test.ts is a MANUAL list: add every new protected route to it (bug S6-004).
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
  router.use('/auth/web', createWebAuthRouter(deps.auth, deps.webSession));
  router.use('/auth', createAuthRouter(deps.auth));
  // Step 8 Parent Portal onboarding: PUBLIC, authorised by the invitation token (see the module).
  router.use(
    '/parent',
    createParentOnboardingRouter({
      db: deps.auth.db,
      pii: deps.pii,
      parentPortal: deps.parentPortal,
      now: deps.auth.now,
    }),
  );
  router.use('/consent-notices', createConsentNoticesRouter(childData));
  // Before '/children' so the nested consent and screening routes are matched first.
  router.use('/children/:childId/consents', createChildConsentsRouter(childData));
  router.use('/children/:childId/screening-eligibility', createScreeningEligibilityRouter(childData));
  router.use('/children/:childId/screenings', createChildScreeningsRouter(childData));
  router.use('/screening-protocols', createScreeningProtocolsRouter(childData));
  router.use('/screenings', createScreeningsRouter(childData));
  router.use('/screening-amendments', createAmendmentQueueRouter(childData));
  router.use('/screening-results', createScreeningResultsRouter(childData));
  router.use('/clinical-rule-sets', createClinicalRuleSetsRouter(childData));
  router.use('/clinical-reviews', createClinicalReviewsRouter(childData));
  router.use('/referrals', createReferralsRouter(childData));
  router.use('/facilities', createFacilitiesRouter(childData));
  router.use('/follow-ups', createFollowUpsRouter(childData));
  router.use('/notifications', createNotificationsRouter(childData));
  router.use('/dashboards', createDashboardsRouter(childData));
  router.use('/reports', createReportsRouter(childData));
  router.use('/children', createChildrenRouter(childData));
  // Before '/guardians' so the nested invitation routes are matched first.
  router.use(
    '/guardians/:guardianId/invitations',
    createGuardianInvitationsRouter({ ...childData, parentPortal: deps.parentPortal }),
  );
  router.use('/guardians', createGuardiansRouter(childData));
  router.use('/users', createUsersRouter(deps.auth));
  router.use('/assignments', createAssignmentsRouter(deps.auth));
  router.use('/roles', createRolesRouter(deps.auth));
  router.use('/areas', createAreasRouter(deps.auth));
  return router;
}
