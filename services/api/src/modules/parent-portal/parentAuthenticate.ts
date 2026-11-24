import type { PrismaClient } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthConfig } from '../../config/security';
import { AppError } from '../../utils/AppError';
import { verifyAccessToken } from '../../utils/jwt';
import type { ParentAuthContext } from './parentAuth.service';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Authenticates a PARENT (Step 8, PP2). Only tokens with the parent audience pass - staff tokens
 * are rejected here, and parent tokens are rejected by the staff `authenticate`. Every request
 * also checks in the database that the account is ACTIVE and the session family is still live,
 * so logout, password reset and disabling take effect immediately.
 */
export function createParentAuthenticate(deps: {
  db: PrismaClient;
  parentAuth: AuthConfig;
  now?: () => Date;
}): RequestHandler {
  const now = deps.now ?? (() => new Date());
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fail = () => {
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        return AppError.unauthorized();
      };
      const match = BEARER.exec(req.header('authorization') ?? '');
      if (!match?.[1]) throw fail();
      const at = now();
      const claims = await verifyAccessToken(deps.parentAuth.jwt, match[1], at);
      if (!claims) throw fail();
      const account = await deps.db.parentAccount.findUnique({
        where: { id: claims.userId },
        select: {
          status: true,
          sessions: {
            where: { familyId: claims.sessionId, revokedAt: null, expiresAt: { gt: at } },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!account || account.status !== 'ACTIVE' || account.sessions.length === 0) throw fail();
      const auth: ParentAuthContext = { parentAccountId: claims.userId, sessionId: claims.sessionId };
      res.locals.parentAuth = auth;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getParentAuth(res: Response): ParentAuthContext {
  const auth = res.locals.parentAuth as ParentAuthContext | undefined;
  if (!auth) throw new Error('getParentAuth called on a route without parent authentication');
  return auth;
}
