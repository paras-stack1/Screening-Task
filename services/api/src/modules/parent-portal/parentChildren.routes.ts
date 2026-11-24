import type { PrismaClient } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AuthConfig } from '../../config/security';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import { AppError } from '../../utils/AppError';
import { createParentAuthenticate, getParentAuth } from './parentAuthenticate';
import { createParentChildrenService } from './parentChildren.service';

const childParams = z.strictObject({ childId: z.uuid() });

/**
 * /api/v1/parent/children (Step 8, stage 6). Signed-in parents only. The child id in the path is
 * never trusted: the service re-checks the parent's own guardian-child access on every call
 * (IDOR/BOLA protection). Limited per account to stop scripted guessing of child ids.
 */
export function createParentChildrenRouter(deps: {
  db: PrismaClient;
  parentAuth: AuthConfig;
  now?: () => Date;
  readsPerAccount?: number;
}): Router {
  const router = Router();
  const service = createParentChildrenService(deps);
  router.use(
    createParentAuthenticate(deps),
    rateLimit({
      windowMs: 15 * 60_000,
      limit: deps.readsPerAccount ?? 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (_req: Request, res: Response) => `parent:${getParentAuth(res).parentAccountId}`,
      handler: (_req: Request, _res: Response, next: NextFunction) => next(AppError.tooManyRequests()),
    }),
  );

  router.get('/', async (_req, res) => {
    res.json({ children: await service.list(getParentAuth(res)) });
  });

  router.get('/:childId', validate({ params: childParams }), async (_req, res) => {
    const { childId } = getValidated<z.infer<typeof childParams>>(res, 'params');
    res.json({ child: await service.get(getParentAuth(res), childId, getRequestId(res)) });
  });

  return router;
}
