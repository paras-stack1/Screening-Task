import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { normalizeLoginId } from '../modules/auth/loginId';
import { AppError } from '../utils/AppError';

/**
 * Request rate limits for authentication endpoints.
 *
 * - Counters are kept in memory per API process. With several API instances each counts
 *   separately; a shared store is needed then (docs/authentication.md, "Known limitations").
 * - Per-IP limits are generous because many field workers can share one mobile-carrier IP
 *   (carrier-grade NAT). Per-account protection comes from the stricter IP + login ID limit and
 *   the temporary account lock in the auth service.
 * - Behind a reverse proxy, TRUST_PROXY_HOPS must be set or every client shares the proxy's IP.
 */
const FIFTEEN_MINUTES = 15 * 60 * 1000;

export interface RateLimitSettings {
  /** All login attempts from one IP (password spraying across accounts). */
  loginPerIp: number;
  /** Login attempts for one login ID from one IP (guessing one account's password). */
  loginPerIpAndAccount: number;
  /** Refresh and logout calls from one IP. */
  refreshPerIp: number;
  /** Password changes by one signed-in user. */
  passwordChangePerUser: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  loginPerIp: 100,
  loginPerIpAndAccount: 10,
  refreshPerIp: 300,
  passwordChangePerUser: 10,
};

function clientIpKey(req: Request): string {
  // ipKeyGenerator groups IPv6 addresses by /56 so one host cannot rotate through its subnet.
  return req.ip ? ipKeyGenerator(req.ip) : 'unknown-ip';
}

function limiter(limit: number, keyGenerator: (req: Request, res: Response) => string): RequestHandler {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    // Same error envelope as every other API error.
    handler: (_req: Request, _res: Response, next: NextFunction) => next(AppError.tooManyRequests()),
  });
}

/** A fresh set of limiters (fresh counters) per app instance. */
export function createAuthRateLimiters(settings: RateLimitSettings = DEFAULT_RATE_LIMITS) {
  return {
    loginPerIp: limiter(settings.loginPerIp, clientIpKey),
    loginPerIpAndAccount: limiter(settings.loginPerIpAndAccount, (req) => {
      const body: unknown = req.body;
      const raw =
        typeof body === 'object' && body !== null && 'loginId' in body && typeof body.loginId === 'string'
          ? body.loginId.slice(0, 64)
          : '';
      return `${clientIpKey(req)}|${normalizeLoginId(raw)}`;
    }),
    refreshPerIp: limiter(settings.refreshPerIp, clientIpKey),
    passwordChangePerUser: limiter(settings.passwordChangePerUser, (req, res) => {
      const auth = res.locals.auth as { userId?: string } | undefined;
      return auth?.userId ?? clientIpKey(req);
    }),
  };
}
