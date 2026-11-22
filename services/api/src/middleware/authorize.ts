import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Db } from '../config/database';
import { hasPermissionAnywhere } from '../modules/access-control/authorization.service';
import type { PermissionCode } from '../modules/access-control/permissions';
import { recordAudit } from '../modules/audit/audit.service';
import { AppError } from '../utils/AppError';
import { getAuth } from './authenticate';
import { getRequestId } from './requestId';

/** Express types `req.route` as `any`; read its path defensively. */
function routePattern(req: Request): string {
  const route: unknown = req.route;
  const path =
    typeof route === 'object' && route !== null && 'path' in route && typeof route.path === 'string'
      ? route.path
      : '';
  return `${req.baseUrl}${path}`;
}

export interface AuthorizeDependencies {
  db: Db;
  now?: () => Date;
}

/**
 * Route-level permission gate (runs after `authenticate`): the caller must hold `permission`
 * through at least one effective assignment. This is the coarse check. WHICH records or areas
 * the caller may touch is decided again in the service layer with the area-scope filters, so a
 * user with child.read in village A still cannot read a child in village B.
 *
 * Denials answer 403 and are audited.
 */
export function createRequirePermission({ db, now = () => new Date() }: AuthorizeDependencies) {
  /** One permission, or a list of which ANY one is enough (e.g. reading protocol content). */
  return function requirePermission(permission: PermissionCode | readonly PermissionCode[]): RequestHandler {
    const anyOf: readonly PermissionCode[] = typeof permission === 'string' ? [permission] : permission;
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = getAuth(res);
        const at = now();
        for (const code of anyOf) {
          if (await hasPermissionAnywhere(db, auth.userId, code, at)) {
            next();
            return;
          }
        }
        await recordAudit(db, {
          actorUserId: auth.userId,
          action: 'authz.denied',
          entityType: 'Route',
          outcome: 'DENIED',
          requestId: getRequestId(res),
          // Route pattern, not the concrete URL: no record ids or query values.
          details: { permission, method: req.method, route: routePattern(req) },
        });
        next(AppError.forbidden());
      } catch (error) {
        next(error);
      }
    };
  };
}
