import { careContentListQuerySchema, type CareContentListQuery } from '@balswasthya/shared-contracts';
import { Router } from 'express';
import { z } from 'zod';
import { createAuthenticate } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getValidated, validate } from '../../middleware/validate';
import type { ScreeningRouterDependencies } from '../screening/protocols.routes';
import { createCareContentService } from './careContent.service';

const idParams = z.strictObject({ id: z.uuid() });

/**
 * /api/v1/care-content - Parent Care content library, read-only (Step 8B). Readable by anyone who
 * screens or reads child records (field workers, medical officers, supervisors). There is no API
 * to create, edit or approve content (decision C2): see docs/step-8/care-content-governance.md.
 */
export function createCareContentRouter(deps: ScreeningRouterDependencies): Router {
  const router = Router();
  const service = createCareContentService(deps);
  const now = deps.now ?? (() => new Date());
  router.use(
    createAuthenticate(deps)(),
    deps.dataRateLimit,
    createRequirePermission(deps)(['screening.conduct', 'child.read']),
  );

  router.get('/', validate({ query: careContentListQuerySchema }), async (_req, res) => {
    res.json(await service.listOffered(getValidated<CareContentListQuery>(res, 'query'), now()));
  });

  router.get('/:id', validate({ params: idParams }), async (_req, res) => {
    const { id } = getValidated<z.infer<typeof idParams>>(res, 'params');
    res.json(await service.get(id));
  });

  return router;
}
