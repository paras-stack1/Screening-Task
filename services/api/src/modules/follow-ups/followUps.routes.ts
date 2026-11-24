import {
  aggregateReportQuerySchema,
  assignFollowUpRequestSchema,
  completeFollowUpRequestSchema,
  createFollowUpRequestSchema,
  followUpListQuerySchema,
  followUpReasonRequestSchema,
  followUpVersionRequestSchema,
  notificationListQuerySchema,
  rescheduleFollowUpRequestSchema,
  type AggregateReportQuery,
  type AssignFollowUpRequest,
  type CompleteFollowUpRequest,
  type CreateFollowUpRequest,
  type FollowUpListQuery,
  type FollowUpReasonRequest,
  type FollowUpVersionRequest,
  type NotificationListQuery,
  type RescheduleFollowUpRequest,
} from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import { createNotificationsService } from '../notifications/notifications.service';
import { createReportsService } from '../reports/reports.service';
import type { ScreeningRouterDependencies } from '../screening/protocols.routes';
import { createFollowUpsService } from './followUps.service';

const idParams = z.strictObject({ id: z.uuid() });
type Id = z.infer<typeof idParams>;

function contextOf(res: Response, now: () => Date): AccessContext {
  return { userId: getAuth(res).userId, requestId: getRequestId(res), at: now() };
}

/**
 * /api/v1/follow-ups (Step 7 stage 7D). Read: child.read. Create: referral.create or
 * referral.update. Assign: referral.update. Work on a task: follow_up.update (own tasks) or
 * referral.update. The service re-checks every action against the task and the child's area.
 */
export function createFollowUpsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createFollowUpsService(deps);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response) => contextOf(res, now);
  const requirePermission = createRequirePermission(deps);
  const work = requirePermission(['follow_up.update', 'referral.update']);
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get(
    '/',
    requirePermission('child.read'),
    validate({ query: followUpListQuerySchema }),
    async (_req, res) => {
      res.json(await service.list(ctx(res), getValidated<FollowUpListQuery>(res, 'query')));
    },
  );
  router.post(
    '/',
    requirePermission(['referral.create', 'referral.update']),
    validate({ body: createFollowUpRequestSchema }),
    async (_req, res) => {
      const { result, replayed } = await service.create(
        ctx(res),
        getValidated<CreateFollowUpRequest>(res, 'body'),
      );
      if (replayed) res.setHeader('Idempotent-Replay', 'true');
      res.status(replayed ? 200 : 201).json({ followUp: result });
    },
  );
  router.get('/:id', requirePermission('child.read'), validate({ params: idParams }), async (_req, res) => {
    res.json({ followUp: await service.get(ctx(res), getValidated<Id>(res, 'params').id) });
  });
  router.post(
    '/:id/assign',
    requirePermission('referral.update'),
    validate({ params: idParams, body: assignFollowUpRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        followUp: await service.assign(ctx(res), id, getValidated<AssignFollowUpRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/start',
    work,
    validate({ params: idParams, body: followUpVersionRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        followUp: await service.start(ctx(res), id, getValidated<FollowUpVersionRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/complete',
    work,
    validate({ params: idParams, body: completeFollowUpRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        followUp: await service.complete(ctx(res), id, getValidated<CompleteFollowUpRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/reschedule',
    work,
    validate({ params: idParams, body: rescheduleFollowUpRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        followUp: await service.reschedule(
          ctx(res),
          id,
          getValidated<RescheduleFollowUpRequest>(res, 'body'),
        ),
      });
    },
  );
  router.post(
    '/:id/miss',
    work,
    validate({ params: idParams, body: followUpReasonRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        followUp: await service.miss(ctx(res), id, getValidated<FollowUpReasonRequest>(res, 'body')),
      });
    },
  );
  router.post(
    '/:id/cancel',
    requirePermission('referral.update'),
    validate({ params: idParams, body: followUpReasonRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<Id>(res, 'params');
      res.json({
        followUp: await service.cancel(ctx(res), id, getValidated<FollowUpReasonRequest>(res, 'body')),
      });
    },
  );
  return router;
}

/** /api/v1/notifications - the signed-in user's own in-app notifications (no other access). */
export function createNotificationsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createNotificationsService(deps);
  const now = deps.now ?? (() => new Date());
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);
  router.get('/', validate({ query: notificationListQuerySchema }), async (_req, res) => {
    res.json(await service.list(getAuth(res).userId, getValidated<NotificationListQuery>(res, 'query')));
  });
  router.post('/:id/read', validate({ params: idParams, body: z.strictObject({}) }), async (_req, res) => {
    res.json({
      notification: await service.markRead(getAuth(res).userId, getValidated<Id>(res, 'params').id, now()),
    });
  });
  return router;
}

/**
 * /api/v1/dashboards (child.read: counts over records the caller may read) and
 * /api/v1/reports/aggregate (report.aggregate: suppressed aggregate counts, no child data).
 */
export function createDashboardsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createReportsService(deps);
  const now = deps.now ?? (() => new Date());
  const read = createRequirePermission(deps)('child.read');
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);
  router.get('/referrals', read, async (_req, res) => {
    res.json({ dashboard: await service.referralDashboard(contextOf(res, now)) });
  });
  router.get('/results', read, async (_req, res) => {
    res.json({ dashboard: await service.resultDashboard(contextOf(res, now)) });
  });
  return router;
}

export function createReportsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createReportsService(deps);
  const now = deps.now ?? (() => new Date());
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);
  router.get(
    '/aggregate',
    createRequirePermission(deps)('report.aggregate'),
    validate({ query: aggregateReportQuerySchema }),
    async (_req, res) => {
      res.json({
        report: await service.aggregate(
          contextOf(res, now),
          getValidated<AggregateReportQuery>(res, 'query'),
        ),
      });
    },
  );
  return router;
}
