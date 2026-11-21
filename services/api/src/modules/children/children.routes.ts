import { childListQuerySchema, type ChildListQuery } from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth, type AuthenticateDependencies } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import { createChildrenService } from './children.service';

export interface ChildrenRouterDependencies extends AuthenticateDependencies {
  db: PrismaClient;
}

const childParamsSchema = z.strictObject({ childId: z.uuid() });

/** /api/v1/children - read-only in Step 3. Every route: authenticate -> permission -> area scope. */
export function createChildrenRouter(deps: ChildrenRouterDependencies): Router {
  const router = Router();
  const authenticate = createAuthenticate(deps);
  const requirePermission = createRequirePermission(deps);
  const service = createChildrenService(deps.db);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response): AccessContext => ({
    userId: getAuth(res).userId,
    requestId: getRequestId(res),
    at: now(),
  });

  router.use(authenticate(), requirePermission('child.read'));

  router.get('/', validate({ query: childListQuerySchema }), async (_req, res) => {
    res.json(await service.list(ctx(res), getValidated<ChildListQuery>(res, 'query')));
  });

  router.get('/:childId', validate({ params: childParamsSchema }), async (_req, res) => {
    const { childId } = getValidated<z.infer<typeof childParamsSchema>>(res, 'params');
    res.json(await service.get(ctx(res), childId));
  });

  return router;
}
