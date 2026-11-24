import {
  PARENT_WEB_CLIENT_VALUE,
  parentChangePasswordRequestSchema,
  parentForgotPasswordRequestSchema,
  parentLoginRequestSchema,
  parentPhoneChangeConfirmRequestSchema,
  parentPhoneChangeStartRequestSchema,
  parentRefreshRequestSchema,
  parentResetPasswordRequestSchema,
  WEB_CLIENT_HEADER,
  type ParentTokensResponse,
  type ParentWebAuthResponse,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { z } from 'zod';
import type { AuthConfig } from '../../config/security';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import { AppError } from '../../utils/AppError';
import type { PiiCrypto } from '../../utils/piiCrypto';
import { readCookie } from '../auth/webAuth.routes';
import type { ParentPortalSettings } from './invitations.service';
import { createParentAuthService } from './parentAuth.service';
import { createParentAuthenticate, getParentAuth } from './parentAuthenticate';

export interface ParentAuthRouterDependencies {
  db: PrismaClient;
  pii: PiiCrypto;
  parentAuth: AuthConfig;
  parentPortal: ParentPortalSettings;
  now?: () => Date;
  /** Browser origins allowed to use the cookie variant (CORS_ORIGINS) and whether the cookie is Secure. */
  web: { allowedOrigins: readonly string[]; secureCookie: boolean };
}

export const PARENT_REFRESH_COOKIE = 'bs_parent_rt';
export const PARENT_COOKIE_PATH = '/api/v1/parent/auth/web';

/** Per-IP limits per 15 minutes (assumptions; per-account lockout and code limits come on top). */
export const DEFAULT_PARENT_AUTH_LIMITS = {
  loginPerIp: 30,
  refreshPerIp: 300,
  resetPerIp: 10,
  accountPerIp: 60,
};

function perIp(limit: number) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => (req.ip ? ipKeyGenerator(req.ip) : 'unknown-ip'),
    handler: (_req: Request, _res: Response, next: NextFunction) => next(AppError.tooManyRequests()),
  });
}

/**
 * /api/v1/parent/auth (Step 8, stage 5). Native app: tokens in the JSON body (kept in SecureStore).
 * Browser: /parent/auth/web/* keeps the refresh token in an httpOnly SameSite=Strict cookie and
 * requires a listed Origin plus the `x-balswasthya-client: parent-portal` header (as the admin
 * portal). login, refresh, logout, forgot-password and reset-password are public; the rest need a
 * parent access token.
 */
export function createParentAuthRouter(deps: ParentAuthRouterDependencies): Router {
  const router = Router();
  const service = createParentAuthService(deps);
  const authenticate = createParentAuthenticate(deps);
  const limits = { ...DEFAULT_PARENT_AUTH_LIMITS, ...deps.parentPortal.authRateLimits };
  const login = perIp(limits.loginPerIp);
  const refresh = perIp(limits.refreshPerIp);
  const reset = perIp(limits.resetPerIp);
  const account = perIp(limits.accountPerIp);
  const meta = (res: Response) => ({ requestId: getRequestId(res) });

  // ------------------------------------------------------------------ browser (cookie) variant
  const web = Router();
  const cookieOptions = {
    httpOnly: true,
    secure: deps.web.secureCookie,
    sameSite: 'strict' as const,
    path: PARENT_COOKIE_PATH,
  };
  const setSession = (res: Response, tokens: ParentTokensResponse): ParentWebAuthResponse => {
    res.cookie(PARENT_REFRESH_COOKIE, tokens.refreshToken, {
      ...cookieOptions,
      expires: new Date(tokens.refreshTokenExpiresAt),
    });
    const { refreshToken: _omitted, ...body } = tokens;
    return body;
  };
  const clearSession = (res: Response) => res.clearCookie(PARENT_REFRESH_COOKIE, cookieOptions);
  web.use((req: Request, _res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (
      !origin ||
      !deps.web.allowedOrigins.includes(origin) ||
      req.headers[WEB_CLIENT_HEADER] !== PARENT_WEB_CLIENT_VALUE
    ) {
      next(AppError.forbidden('ORIGIN_NOT_ALLOWED', 'This sign-in is only available to the Parent Portal'));
      return;
    }
    next();
  });
  web.post('/login', login, validate({ body: parentLoginRequestSchema }), async (_req, res) => {
    const input = getValidated<z.output<typeof parentLoginRequestSchema>>(res, 'body');
    res.json(setSession(res, await service.login(meta(res), input)));
  });
  web.post('/refresh', refresh, async (req, res) => {
    const token = readCookie(req, PARENT_REFRESH_COOKIE);
    if (!token) throw AppError.unauthorized('SESSION_EXPIRED', 'Session expired. Please sign in again.');
    try {
      res.json(setSession(res, await service.refresh(meta(res), token)));
    } catch (error) {
      clearSession(res);
      throw error;
    }
  });
  web.post('/logout', refresh, async (req, res) => {
    const token = readCookie(req, PARENT_REFRESH_COOKIE);
    if (token) await service.logout(meta(res), token);
    clearSession(res);
    res.status(204).end();
  });
  web.post(
    '/change-password',
    authenticate,
    account,
    validate({ body: parentChangePasswordRequestSchema }),
    async (_req, res) => {
      const input = getValidated<z.output<typeof parentChangePasswordRequestSchema>>(res, 'body');
      res.json(setSession(res, await service.changePassword(meta(res), getParentAuth(res), input)));
    },
  );
  router.use('/web', web);

  // ------------------------------------------------------------------ native (body) variant
  router.post('/login', login, validate({ body: parentLoginRequestSchema }), async (_req, res) => {
    const input = getValidated<z.output<typeof parentLoginRequestSchema>>(res, 'body');
    res.json(await service.login(meta(res), input));
  });
  router.post('/refresh', refresh, validate({ body: parentRefreshRequestSchema }), async (_req, res) => {
    const { refreshToken } = getValidated<z.output<typeof parentRefreshRequestSchema>>(res, 'body');
    res.json(await service.refresh(meta(res), refreshToken));
  });
  /** Always 204: no token-validity oracle. */
  router.post('/logout', refresh, validate({ body: parentRefreshRequestSchema }), async (_req, res) => {
    const { refreshToken } = getValidated<z.output<typeof parentRefreshRequestSchema>>(res, 'body');
    await service.logout(meta(res), refreshToken);
    res.status(204).end();
  });
  router.post(
    '/forgot-password',
    reset,
    validate({ body: parentForgotPasswordRequestSchema }),
    async (_req, res) => {
      const { phone } = getValidated<z.output<typeof parentForgotPasswordRequestSchema>>(res, 'body');
      res.status(202).json(await service.forgotPassword(meta(res), phone));
    },
  );
  router.post(
    '/reset-password',
    reset,
    validate({ body: parentResetPasswordRequestSchema }),
    async (_req, res) => {
      const input = getValidated<z.output<typeof parentResetPasswordRequestSchema>>(res, 'body');
      res.json(await service.resetPassword(meta(res), input));
    },
  );

  // ------------------------------------------------------------------ signed-in parent
  router.get('/me', authenticate, account, async (_req, res) => {
    res.json({ account: await service.accountDto(getParentAuth(res).parentAccountId) });
  });
  router.post('/logout-all', authenticate, account, async (_req, res) => {
    await service.logoutAll(meta(res), getParentAuth(res));
    res.status(204).end();
  });
  router.post(
    '/change-password',
    authenticate,
    account,
    validate({ body: parentChangePasswordRequestSchema }),
    async (_req, res) => {
      const input = getValidated<z.output<typeof parentChangePasswordRequestSchema>>(res, 'body');
      res.json(await service.changePassword(meta(res), getParentAuth(res), input));
    },
  );
  router.post(
    '/phone-change/start',
    authenticate,
    reset,
    validate({ body: parentPhoneChangeStartRequestSchema }),
    async (_req, res) => {
      const input = getValidated<z.output<typeof parentPhoneChangeStartRequestSchema>>(res, 'body');
      res.json(await service.startPhoneChange(meta(res), getParentAuth(res), input));
    },
  );
  router.post(
    '/phone-change/confirm',
    authenticate,
    reset,
    validate({ body: parentPhoneChangeConfirmRequestSchema }),
    async (_req, res) => {
      const input = getValidated<z.output<typeof parentPhoneChangeConfirmRequestSchema>>(res, 'body');
      res.json({ account: await service.confirmPhoneChange(meta(res), getParentAuth(res), input) });
    },
  );

  return router;
}
