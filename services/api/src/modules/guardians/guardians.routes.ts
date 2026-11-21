import { updateGuardianRequestSchema } from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createRequirePermission } from '../../middleware/authorize';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import type { AccessContext } from '../access-control/accessScope';
import type { ChildrenRouterDependencies } from '../children/children.routes';
import { createGuardiansService } from './guardians.service';

const guardianParams = z.strictObject({ guardianId: z.uuid() });
type GuardianParams = z.infer<typeof guardianParams>;

/**
 * /api/v1/guardians. There is deliberately NO list/search and NO create endpoint (decision E):
 * guardians are created with a child and reached only through a child the caller may access,
 * so no endpoint can enumerate households outside the caller's scope.
 */
export function createGuardiansRouter(deps: ChildrenRouterDependencies): Router {
  const router = Router();
  const requirePermission = createRequirePermission(deps);
  const service = createGuardiansService(deps);
  const now = deps.now ?? (() => new Date());
  const ctx = (res: Response): AccessContext => ({
    userId: getAuth(res).userId,
    requestId: getRequestId(res),
    at: now(),
  });

  router.use(createAuthenticate(deps)(), deps.dataRateLimit);

  router.get(
    '/:guardianId',
    requirePermission('child.read'),
    validate({ params: guardianParams }),
    async (_req, res) => {
      const { guardianId } = getValidated<GuardianParams>(res, 'params');
      res.json(await service.get(ctx(res), guardianId));
    },
  );

  router.patch(
    '/:guardianId',
    requirePermission('child.update'),
    validate({ params: guardianParams, body: updateGuardianRequestSchema }),
    async (_req, res) => {
      const { guardianId } = getValidated<GuardianParams>(res, 'params');
      const body = getValidated<z.output<typeof updateGuardianRequestSchema>>(res, 'body');
      res.json(await service.update(ctx(res), guardianId, body));
    },
  );

  return router;
}
