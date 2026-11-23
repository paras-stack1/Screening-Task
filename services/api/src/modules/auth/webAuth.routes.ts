import {
  AUTH_ERROR_CODES,
  changePasswordRequestSchema,
  loginRequestSchema,
  WEB_CLIENT_HEADER,
  WEB_CLIENT_VALUE,
  type AuthTokensResponse,
  type ChangePasswordRequest,
  type LoginRequest,
  type WebAuthResponse,
} from '@balswasthya/shared-contracts';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { createAuthenticate, getAuth } from '../../middleware/authenticate';
import { createAuthRateLimiters } from '../../middleware/rateLimit';
import { getRequestId } from '../../middleware/requestId';
import { getValidated, validate } from '../../middleware/validate';
import { AppError } from '../../utils/AppError';
import type { AuthRouterDependencies } from './auth.routes';
import { createAuthService } from './auth.service';

/**
 * /api/v1/auth/web - browser sign-in for the admin portal (admin portal decision P4).
 *
 * Same accounts, sessions, rotation, reuse detection, lockout and audit as /auth/*; the only
 * difference is WHERE the refresh token travels: in an httpOnly, SameSite=Strict cookie scoped
 * to this path, never in a JSON body. Page scripts therefore cannot read it, and the browser
 * sends it nowhere except these endpoints. The access token is returned in the body and kept in
 * memory by the portal.
 *
 * CSRF defence in depth (the cookie is the credential here):
 *  1. SameSite=Strict - the browser never attaches the cookie to a cross-site request;
 *  2. the Origin header must be present and listed in CORS_ORIGINS;
 *  3. a custom header (x-balswasthya-client: admin-portal) is required, which forces a CORS
 *     preflight that unlisted origins fail.
 */
export const WEB_REFRESH_COOKIE = 'bs_admin_rt';
export const WEB_COOKIE_PATH = '/api/v1/auth/web';

export interface WebSessionSettings {
  /** Secure cookie (HTTPS only). Always true in production. */
  secureCookie: boolean;
  /** Browser origins allowed to use these endpoints (CORS_ORIGINS). */
  allowedOrigins: readonly string[];
}

/** Reads one cookie from the Cookie header (no cookie-parser dependency for a single value). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      const raw = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function createWebAuthRouter(deps: AuthRouterDependencies, settings: WebSessionSettings): Router {
  const router = Router();
  const service = createAuthService(deps);
  const authenticate = createAuthenticate(deps);
  const limits = createAuthRateLimiters(deps.rateLimits);
  const meta = (res: Response) => ({ requestId: getRequestId(res) });

  const cookieOptions = {
    httpOnly: true,
    secure: settings.secureCookie,
    sameSite: 'strict' as const,
    path: WEB_COOKIE_PATH,
  };

  function setSession(res: Response, tokens: AuthTokensResponse): WebAuthResponse {
    res.cookie(WEB_REFRESH_COOKIE, tokens.refreshToken, {
      ...cookieOptions,
      expires: new Date(tokens.refreshTokenExpiresAt),
    });
    const { refreshToken: _omitted, ...body } = tokens;
    return body;
  }

  function clearSession(res: Response) {
    res.clearCookie(WEB_REFRESH_COOKIE, cookieOptions);
  }

  /** Browser-only endpoints: a listed Origin and the portal header are both required. */
  router.use((req: Request, _res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin || !settings.allowedOrigins.includes(origin)) {
      next(AppError.forbidden('ORIGIN_NOT_ALLOWED', 'This sign-in is only available to the admin portal'));
      return;
    }
    if (req.headers[WEB_CLIENT_HEADER] !== WEB_CLIENT_VALUE) {
      next(AppError.forbidden('WEB_CLIENT_REQUIRED', 'This sign-in is only available to the admin portal'));
      return;
    }
    next();
  });

  router.post(
    '/login',
    limits.loginPerIp,
    limits.loginPerIpAndAccount,
    validate({ body: loginRequestSchema }),
    async (_req, res) => {
      const tokens = await service.login(getValidated<LoginRequest>(res, 'body'), meta(res));
      res.json(setSession(res, tokens));
    },
  );

  router.post('/refresh', limits.refreshPerIp, async (req, res) => {
    const token = readCookie(req, WEB_REFRESH_COOKIE);
    if (!token) {
      throw AppError.unauthorized(AUTH_ERROR_CODES.sessionExpired, 'Session expired. Please sign in again.');
    }
    try {
      res.json(setSession(res, await service.refresh(token, meta(res))));
    } catch (error) {
      // A dead session must not leave a cookie behind that every later call would resend.
      clearSession(res);
      throw error;
    }
  });

  /** Always 204 (no token-validity oracle); always clears the cookie. */
  router.post('/logout', limits.refreshPerIp, async (req, res) => {
    const token = readCookie(req, WEB_REFRESH_COOKIE);
    if (token) await service.logout(token, meta(res));
    clearSession(res);
    res.status(204).end();
  });

  /** Password change revokes every session and starts a new one: the cookie is replaced. */
  router.post(
    '/change-password',
    authenticate({ allowPasswordChangeRequired: true }),
    limits.passwordChangePerUser,
    validate({ body: changePasswordRequestSchema }),
    async (_req, res) => {
      const input = getValidated<ChangePasswordRequest>(res, 'body');
      res.json(setSession(res, await service.changePassword(getAuth(res), input, meta(res))));
    },
  );

  return router;
}
