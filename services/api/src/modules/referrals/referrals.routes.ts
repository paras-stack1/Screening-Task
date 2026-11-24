import {
  referralCloseRequestSchema,
  referralCorrectionRequestSchema,
  referralTrackingRequestSchema,
  type ReferralCloseRequest,
  type ReferralCorrectionRequest,
  type ReferralTrackingRequest,
  approveReferralRequestSchema,
  changeFacilityRequestSchema,
  createReferralRequestSchema,
  facilityListQuerySchema,
  issueReferralRequestSchema,
  referralListQuerySchema,
  referralReasonRequestSchema,
  reviewDecisionRequestSchema,
  reviewListQuerySchema,
  reviewVersionRequestSchema,
  type ApproveReferralRequest,
  type ChangeFacilityRequest,
  type CreateReferralRequest,
  type FacilityListQuery,
  type IssueReferralRequest,
  type ReferralListQuery,
  type ReferralReasonRequest,
  type ReviewDecisionRequest,
  type ReviewListQuery,
  type ReviewVersionRequest,
} from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import { createReviewService } from '../clinical-review/review.service';
import { createFacilitiesService } from '../facilities/facilities.service';
import type { ScreeningRouterDependencies } from '../screening/protocols.routes';
import { createReferralsService } from './referrals.service';

const idParams = z.strictObject({ id: z.uuid() });
const impactParams = z.strictObject({ id: z.uuid(), impactId: z.uuid() });
type Id = z.infer<typeof idParams>;

function contextOf(res: Response, now: () => Date): AccessContext {
  return { userId: getAuth(res).userId, requestId: getRequestId(res), at: now() };
}

/**
 * /api/v1/clinical-reviews (Step 7 stage 7C). screening.review only; record scope, claim and
 * version are checked in the service. There is no "create" route: review tasks are created with
 * each result run (decision G).
 */
export function createClinicalReviewsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createReviewService(deps);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response) => contextOf(res, now);
  const review = createRequirePermission(deps)('screening.review');
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get('/', review, validate({ query: reviewListQuerySchema }), async (_req, res) => {
    res.json(await service.list(ctx(res), getValidated<ReviewListQuery>(res, 'query')));
  });
  router.get('/:id', review, validate({ params: idParams }), async (_req, res) => {
    res.json({ review: await service.get(ctx(res), getValidated<Id>(res, 'params').id) });
  });
  router.post(
    '/:id/claim',
    review,
    validate({ params: idParams, body: reviewVersionRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        review: await service.claim(ctx(res), id, getValidated<ReviewVersionRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/release',
    review,
    validate({ params: idParams, body: reviewVersionRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        review: await service.release(ctx(res), id, getValidated<ReviewVersionRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/decision',
    review,
    validate({ params: idParams, body: reviewDecisionRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        review: await service.decide(ctx(res), id, getValidated<ReviewDecisionRequest>(res, 'body')),
      });
    },
  );
  return router;
}

/**
 * /api/v1/referrals (Step 7 stage 7C). Reading needs child.read; each action's route permission
 * is only a first filter - the service decides the action from the caller's permissions over the
 * child's current area, the referral state and (for issue) consent.
 */
export function createReferralsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createReferralsService(deps);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response) => contextOf(res, now);
  const requirePermission = createRequirePermission(deps);
  const read = requirePermission('child.read');
  const anyReferral = requirePermission(['referral.create', 'referral.approve', 'referral.update']);
  const approve = requirePermission('referral.approve');
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get('/', read, validate({ query: referralListQuerySchema }), async (_req, res) => {
    res.json(await service.list(ctx(res), getValidated<ReferralListQuery>(res, 'query')));
  });
  router.post(
    '/',
    requirePermission('referral.create'),
    validate({ body: createReferralRequestSchema }),
    async (_req, res) => {
      const { result, replayed } = await service.create(
        ctx(res),
        getValidated<CreateReferralRequest>(res, 'body'),
      );
      if (replayed) res.setHeader('Idempotent-Replay', 'true');
      res.status(replayed ? 200 : 201).json({ referral: result });
    },
  );
  router.get('/:id', read, validate({ params: idParams }), async (_req, res) => {
    res.json({ referral: await service.get(ctx(res), getValidated<Id>(res, 'params').id) });
  });
  router.get('/:id/history', read, validate({ params: idParams }), async (_req, res) => {
    const referral = await service.get(ctx(res), getValidated<Id>(res, 'params').id);
    res.json({ history: referral.history });
  });
  router.post(
    '/:id/approve',
    approve,
    validate({ params: idParams, body: approveReferralRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        referral: await service.approve(ctx(res), id, getValidated<ApproveReferralRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/reject',
    approve,
    validate({ params: idParams, body: referralReasonRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        referral: await service.reject(ctx(res), id, getValidated<ReferralReasonRequest>(res, 'body')),
      });
    },
  );
  router.patch(
    '/:id/facility',
    anyReferral,
    validate({ params: idParams, body: changeFacilityRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        referral: await service.changeFacility(
          ctx(res),
          id,
          getValidated<ChangeFacilityRequest>(res, 'body'),
        ),
      });
    },
  );
  router.post(
    '/:id/issue',
    anyReferral,
    validate({ params: idParams, body: issueReferralRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        referral: await service.issue(ctx(res), id, getValidated<IssueReferralRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/cancel',
    anyReferral,
    validate({ params: idParams, body: referralReasonRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        referral: await service.cancel(ctx(res), id, getValidated<ReferralReasonRequest>(res, 'body')),
      });
    },
  );
  // Stage 7D: tracking after issue, closure and corrections (medical officers / supervisors).
  const track = requirePermission(['referral.update', 'referral.approve']);
  router.post(
    '/:id/tracking',
    track,
    validate({ params: idParams, body: referralTrackingRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        referral: await service.track(ctx(res), id, getValidated<ReferralTrackingRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/close',
    track,
    validate({ params: idParams, body: referralCloseRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        referral: await service.close(ctx(res), id, getValidated<ReferralCloseRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/corrections',
    track,
    validate({ params: idParams, body: referralCorrectionRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        referral: await service.correct(ctx(res), id, getValidated<ReferralCorrectionRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/reassessments/:impactId',
    requirePermission(['referral.approve', 'screening.review']),
    validate({ params: impactParams, body: z.strictObject({}) }),
    async (_req, res) => {
      const { id, impactId } = getValidated<z.infer<typeof impactParams>>(res, 'params');
      res.json({ referral: await service.reassess(ctx(res), id, impactId) });
    },
  );
  return router;
}

/** /api/v1/facilities - read-only directory for referrals (writes come with stage 7G). */
export function createFacilitiesRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createFacilitiesService(deps);
  const now = deps.now ?? (() => new Date());
  const read = createRequirePermission(deps)([
    'referral.create',
    'referral.approve',
    'referral.update',
    'facility.manage',
  ]);
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get('/', read, validate({ query: facilityListQuerySchema }), async (_req, res) => {
    res.json(await service.list(contextOf(res, now), getValidated<FacilityListQuery>(res, 'query')));
  });
  router.get('/:id', read, validate({ params: idParams }), async (_req, res) => {
    res.json(await service.get(getValidated<Id>(res, 'params').id));
  });
  return router;
}
