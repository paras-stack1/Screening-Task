import { areaListQuerySchema, type AreaListQuery } from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { createAuthenticate, getAuth, type AuthenticateDependencies } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getValidated, validate } from '../../middleware/validate';
import { createAreasService } from './areas.service';

export interface AreasRouterDependencies extends AuthenticateDependencies {
  db: PrismaClient;
}

/**
 * /api/v1/areas - area tree for administration forms (admin portal). Gate: user.manage OR
 * assignment.manage; results are limited to the areas where the caller holds one of them.
 */
export function createAreasRouter(deps: AreasRouterDependencies): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const service = createAreasService(deps.db);
  router.use(createAuthenticate(deps)(), createRequirePermission(deps)(['user.manage', 'assignment.manage']));

  router.get('/', validate({ query: areaListQuerySchema }), async (_req, res) => {
    const ctx = { userId: getAuth(res).userId, at: now() };
    res.json(await service.list(ctx, getValidated<AreaListQuery>(res, 'query')));
  });

  return router;
}
