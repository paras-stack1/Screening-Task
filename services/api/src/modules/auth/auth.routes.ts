import {
  changePasswordRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type RefreshRequest,
} from '@balswasthya/shared-contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createAuthRateLimiters, type RateLimitSettings } from '../../middleware/rateLimit';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import { createAuthService, type AuthServiceDependencies } from './auth.service';

export interface AuthRouterDependencies extends AuthServiceDependencies {
  rateLimits?: RateLimitSettings;
}

const sessionParamsSchema = z.strictObject({ sessionId: z.uuid() });

const meta = (res: Response) => ({ requestId: getRequestId(res) });

/**
 * /api/v1/auth - see docs/authentication.md for request/response examples.
 * Controllers are thin: validated input in, service call, JSON out.
 */
export function createAuthRouter(deps: AuthRouterDependencies): Router {
  const router = Router();
  const service = createAuthService(deps);
  const authenticate = createAuthenticate(deps);
  const limits = createAuthRateLimiters(deps.rateLimits);

  router.post(
    '/login',
    limits.loginPerIp,
    limits.loginPerIpAndAccount,
    validate({ body: loginRequestSchema }),
    async (_req, res) => {
      res.json(await service.login(getValidated<LoginRequest>(res, 'body'), meta(res)));
    },
  );

  router.post(
    '/refresh',
    limits.refreshPerIp,
    validate({ body: refreshRequestSchema }),
    async (_req, res) => {
      res.json(await service.refresh(getValidated<RefreshRequest>(res, 'body').refreshToken, meta(res)));
    },
  );

  /** Ends the session of the presented refresh token. Works with an expired access token. */
  router.post('/logout', limits.refreshPerIp, validate({ body: logoutRequestSchema }), async (_req, res) => {
    await service.logout(getValidated<RefreshRequest>(res, 'body').refreshToken, meta(res));
    res.status(204).end();
  });

  router.post('/logout-all', authenticate({ allowPasswordChangeRequired: true }), async (_req, res) => {
    await service.logoutAll(getAuth(res), meta(res));
    res.status(204).end();
  });

  router.post(
    '/change-password',
    authenticate({ allowPasswordChangeRequired: true }),
    limits.passwordChangePerUser,
    validate({ body: changePasswordRequestSchema }),
    async (_req, res) => {
      const input = getValidated<ChangePasswordRequest>(res, 'body');
      res.json(await service.changePassword(getAuth(res), input, meta(res)));
    },
  );

  router.get('/me', authenticate({ allowPasswordChangeRequired: true }), async (_req, res) => {
    res.json(await service.me(getAuth(res)));
  });

  router.get('/sessions', authenticate(), async (_req, res) => {
    res.json(await service.listSessions(getAuth(res)));
  });

  router.delete(
    '/sessions/:sessionId',
    authenticate(),
    validate({ params: sessionParamsSchema }),
    async (_req, res) => {
      const { sessionId } = getValidated<z.infer<typeof sessionParamsSchema>>(res, 'params');
      await service.revokeSession(getAuth(res), sessionId, meta(res));
      res.status(204).end();
    },
  );

  return router;
}
