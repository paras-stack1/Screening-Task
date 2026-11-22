import {
  addMeasurementRequestSchema,
  cancelSessionRequestSchema,
  completeSessionRequestSchema,
  correctMeasurementRequestSchema,
  fourDCategorySchema,
  saveResponsesRequestSchema,
  screeningHistoryQuerySchema,
  screeningListQuerySchema,
  startCategoryRequestSchema,
  startScreeningRequestSchema,
  updateCategoryRequestSchema,
  type AddMeasurementRequest,
  type CancelSessionRequest,
  type CompleteSessionRequest,
  type CorrectMeasurementRequest,
  type ScreeningHistoryQuery,
  type ScreeningListQuery,
  type StartCategoryRequest,
  type StartScreeningRequest,
  type UpdateCategoryRequest,
} from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import type { ScreeningRouterDependencies } from './protocols.routes';
import { createScreeningsService } from './screenings.service';

const idParams = z.strictObject({ id: z.uuid() });
const categoryParams = z.strictObject({ id: z.uuid(), category: fourDCategorySchema });
const measurementParams = z.strictObject({ id: z.uuid(), measurementId: z.uuid() });
const childParams = z.strictObject({ childId: z.uuid() });

function contextOf(res: Response, now: () => Date): AccessContext {
  return { userId: getAuth(res).userId, requestId: getRequestId(res), at: now() };
}

/**
 * /api/v1/screenings (Step 6 stage 6C, docs/step-6/screening-api.md).
 * Reads need child.read; writes need screening.conduct. Record-level scope, ownership, version
 * and consent are checked in the service for every request - the route permission never grants
 * a record on its own.
 */
export function createScreeningsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const requirePermission = createRequirePermission(deps);
  const service = createScreeningsService(deps);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response) => contextOf(res, now);
  const read = requirePermission('child.read');
  const conduct = requirePermission('screening.conduct');
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get('/', read, validate({ query: screeningListQuerySchema }), async (_req, res) => {
    res.json(await service.list(ctx(res), getValidated<ScreeningListQuery>(res, 'query')));
  });

  // Before '/:id' so "summary" is never read as an id.
  router.get('/summary', conduct, async (_req, res) => {
    res.json(await service.summary(ctx(res)));
  });

  router.post('/', conduct, validate({ body: startScreeningRequestSchema }), async (_req, res) => {
    const { result, replayed } = await service.start(
      ctx(res),
      getValidated<StartScreeningRequest>(res, 'body'),
    );
    if (replayed) res.setHeader('Idempotent-Replay', 'true');
    res.status(replayed ? 200 : 201).json(result);
  });

  router.get('/:id', read, validate({ params: idParams }), async (_req, res) => {
    const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
    res.json(await service.get(ctx(res), id));
  });

  router.post(
    '/:id/categories',
    conduct,
    validate({ params: idParams, body: startCategoryRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
      res
        .status(201)
        .json(await service.startCategory(ctx(res), id, getValidated<StartCategoryRequest>(res, 'body')));
    },
  );

  router.patch(
    '/:id/categories/:category',
    conduct,
    validate({ params: categoryParams, body: updateCategoryRequestSchema }),
    async (_req, res) => {
      const { id, category } = getValidated<z.infer<typeof categoryParams>>(res, 'params');
      res.json(
        await service.updateCategory(
          ctx(res),
          id,
          category,
          getValidated<UpdateCategoryRequest>(res, 'body'),
        ),
      );
    },
  );

  router.post(
    '/:id/categories/:category/responses',
    conduct,
    validate({ params: categoryParams, body: saveResponsesRequestSchema }),
    async (_req, res) => {
      const { id, category } = getValidated<z.infer<typeof categoryParams>>(res, 'params');
      const body = getValidated<z.output<typeof saveResponsesRequestSchema>>(res, 'body');
      res.json(await service.saveResponses(ctx(res), id, category, body));
    },
  );

  router.post(
    '/:id/measurements',
    conduct,
    validate({ params: idParams, body: addMeasurementRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
      res
        .status(201)
        .json(await service.addMeasurement(ctx(res), id, getValidated<AddMeasurementRequest>(res, 'body')));
    },
  );

  router.post(
    '/:id/measurements/:measurementId/corrections',
    conduct,
    validate({ params: measurementParams, body: correctMeasurementRequestSchema }),
    async (_req, res) => {
      const { id, measurementId } = getValidated<z.infer<typeof measurementParams>>(res, 'params');
      const body = getValidated<CorrectMeasurementRequest>(res, 'body');
      res.status(201).json(await service.correctMeasurement(ctx(res), id, measurementId, body));
    },
  );

  router.post(
    '/:id/complete',
    conduct,
    validate({ params: idParams, body: completeSessionRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
      const { result, replayed } = await service.complete(
        ctx(res),
        id,
        getValidated<CompleteSessionRequest>(res, 'body'),
      );
      if (replayed) res.setHeader('Idempotent-Replay', 'true');
      res.json(result);
    },
  );

  router.post(
    '/:id/cancel',
    conduct,
    validate({ params: idParams, body: cancelSessionRequestSchema }),
    async (_req, res) => {
      const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
      res.json(await service.cancel(ctx(res), id, getValidated<CancelSessionRequest>(res, 'body')));
    },
  );

  return router;
}

/** /api/v1/children/:childId/screenings - a child's screening history (paginated). */
export function createChildScreeningsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  const service = createScreeningsService(deps);
  const now = deps.now ?? (() => new Date());
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);
  router.get(
    '/',
    createRequirePermission(deps)('child.read'),
    validate({ params: childParams, query: screeningHistoryQuerySchema }),
    async (_req, res) => {
      const { childId } = getValidated<z.infer<typeof childParams>>(res, 'params');
      res.json(
        await service.history(
          contextOf(res, now),
          childId,
          getValidated<ScreeningHistoryQuery>(res, 'query'),
        ),
      );
    },
  );
  return router;
}
