import {
  clinicalRuleSetListQuerySchema,
  resultListQuerySchema,
  type ClinicalRuleSetListQuery,
  type ResultListQuery,
} from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import type { ScreeningRouterDependencies } from '../screening/protocols.routes';
import { createResultsService } from './results.service';

const idParams = z.strictObject({ id: z.uuid() });

function contextOf(res: Response, now: () => Date): AccessContext {
  return { userId: getAuth(res).userId, requestId: getRequestId(res), at: now() };
}

/**
 * Result routes nested under a screening, added to the /api/v1/screenings router (which has
 * already authenticated and rate-limited the request): GET /:id/results (child.read) and
 * POST /:id/generate-result (screening.conduct or screening.review; record scope in the service).
 */
export function addSessionResultRoutes(router: Router, deps: ScreeningRouterDependencies): void {
  const service = createResultsService(deps);
  const now = deps.now ?? (() => new Date());
  const requirePermission = createRequirePermission(deps);

  router.get(
    '/:id/results',
    requirePermission('child.read'),
    validate({ params: idParams }),
    async (_req, res) => {
      const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
      res.json(await service.forSession(contextOf(res, now), id));
    },
  );

  router.post(
    '/:id/generate-result',
    requirePermission(['screening.conduct', 'screening.review']),
    validate({ params: idParams, body: z.strictObject({}) }),
    async (_req, res) => {
      const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
      const outcome = await service.generate(contextOf(res, now), id);
      if (outcome.replayed) res.setHeader('Idempotent-Replay', 'true');
      res.status(outcome.replayed ? 200 : 201).json(outcome);
    },
  );
}

/** /api/v1/screening-results - current results in the caller's scope (child.read). */
export function createScreeningResultsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createResultsService(deps);
  const now = deps.now ?? (() => new Date());
  const read = createRequirePermission(deps)('child.read');
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get('/', read, validate({ query: resultListQuerySchema }), async (_req, res) => {
    res.json(await service.list(contextOf(res, now), getValidated<ResultListQuery>(res, 'query')));
  });
  router.get('/:id', read, validate({ params: idParams }), async (_req, res) => {
    const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
    res.json({ result: await service.get(contextOf(res, now), id) });
  });
  return router;
}

/**
 * /api/v1/clinical-rule-sets - READ-ONLY rule-set catalogue for clinical reviewers (decision B).
 * There is no API to create, edit, approve or activate rules: CLI scripts only.
 */
export function createClinicalRuleSetsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createResultsService(deps);
  const review = createRequirePermission(deps)('screening.review');
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get('/', review, validate({ query: clinicalRuleSetListQuerySchema }), async (_req, res) => {
    res.json(await service.ruleSets(getValidated<ClinicalRuleSetListQuery>(res, 'query')));
  });
  router.get('/:id', review, validate({ params: idParams }), async (_req, res) => {
    const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
    res.json(await service.ruleSet(id));
  });
  return router;
}
