import { AUTH_ERROR_CODES } from '@balswasthya/shared-contracts';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Db } from '../config/database';
import type { AuthConfig } from '../config/security';
import type { AuthContext } from '../modules/auth/auth.service';
import { AppError } from '../utils/AppError';
import { verifyAccessToken } from '../utils/jwt';

export interface AuthenticateDependencies {
  db: Db;
  config: AuthConfig;
  now?: () => Date;
}

export interface AuthenticateOptions {
  /**
   * Routes a user with `mustChangePassword` may still call (me, change-password, logout-all).
   * Every other route answers 403 PASSWORD_CHANGE_REQUIRED until the password is changed.
   */
  allowPasswordChangeRequired?: boolean;
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

function unauthenticated(res: Response) {
  res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
  return AppError.unauthorized();
}

/**
 * Authentication (who is calling). Authorisation (what they may do, where) is separate and is
 * checked per route against the database.
 *
 * Every request: verify the JWT (signature, alg, typ, iss, aud, exp, nbf, claims), then ONE
 * database read confirming the user is still ACTIVE and the session family (`sid`) is still
 * active. So logout, password change, session revocation and account suspension take effect
 * immediately, not when the access token expires.
 */
export function createAuthenticate({ db, config, now = () => new Date() }: AuthenticateDependencies) {
  return function authenticate(options: AuthenticateOptions = {}): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const match = BEARER.exec(req.header('authorization') ?? '');
        if (!match?.[1]) throw unauthenticated(res);

        const at = now();
        const claims = await verifyAccessToken(config.jwt, match[1], at);
        if (!claims) throw unauthenticated(res);

        const user = await db.user.findUnique({
          where: { id: claims.userId },
          select: {
            status: true,
            mustChangePassword: true,
            refreshSessions: {
              where: { familyId: claims.sessionId, revokedAt: null, expiresAt: { gt: at } },
              select: { id: true },
              take: 1,
            },
          },
        });
        if (!user || user.status !== 'ACTIVE' || user.refreshSessions.length === 0) {
          throw unauthenticated(res);
        }

        if (user.mustChangePassword && !options.allowPasswordChangeRequired) {
          throw AppError.forbidden(
            AUTH_ERROR_CODES.passwordChangeRequired,
            'You must change your password before continuing',
          );
        }

        const auth: AuthContext = {
          userId: claims.userId,
          sessionId: claims.sessionId,
          mustChangePassword: user.mustChangePassword,
        };
        res.locals.auth = auth;
        next();
      } catch (error) {
        next(error);
      }
    };
  };
}

/** Typed accessor. Throws (500) if a route forgot `authenticate` - a programming error, never a pass. */
export function getAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) throw new Error('getAuth called on a route without authenticate()');
  return auth;
}
