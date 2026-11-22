import {
  screeningProtocolListQuerySchema,
  type ScreeningProtocolListQuery,
} from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import type { ConsentRouterDependencies } from '../consent/consent.routes';
import type { ScreeningPolicySettings } from './protocolSelection';
import { createProtocolsService } from './protocols.service';

export interface ScreeningRouterDependencies extends ConsentRouterDependencies {
  screeningPolicy: ScreeningPolicySettings;
}

const idParams = z.strictObject({ id: z.uuid() });
const childParams = z.strictObject({ childId: z.uuid() });

/**
 * /api/v1/screening-protocols - read-only protocol content (Step 6 decision S). There is no API
 * to create, edit or approve protocols: changes go through the governed admin process
 * (docs/step-6/clinical-content-governance.md). Readable by anyone who screens or reads child
 * records (decision M).
 */
export function createScreeningProtocolsRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createProtocolsService(deps);
  const now = deps.now ?? (() => new Date());
  router.use(
    createAuthenticate(deps)(),
    deps.dataRateLimit,
    createRequirePermission(deps)(['screening.conduct', 'child.read']),
  );

  router.get('/', validate({ query: screeningProtocolListQuerySchema }), async (_req, res) => {
    res.json(await service.listUsable(getValidated<ScreeningProtocolListQuery>(res, 'query'), now()));
  });

  router.get('/:id', validate({ params: idParams }), async (_req, res) => {
    const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
    res.json(await service.get(id));
  });

  router.get('/:id/versions', validate({ params: idParams }), async (_req, res) => {
    const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
    res.json(await service.versions(id));
  });

  return router;
}

/**
 * /api/v1/children/:childId/screening-eligibility - age, consent and protocol availability for
 * starting a screening today. The child is verified against the caller's scope in the service.
 */
export function createScreeningEligibilityRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  const service = createProtocolsService(deps);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response): AccessContext => ({
    userId: getAuth(res).userId,
    requestId: getRequestId(res),
    at: now(),
  });
  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get(
    '/',
    createRequirePermission(deps)('screening.conduct'),
    validate({ params: childParams }),
    async (_req, res) => {
      const { childId } = getValidated<z.infer<typeof childParams>>(res, 'params');
      res.json(await service.eligibility(ctx(res), childId));
    },
  );

  return router;
}
