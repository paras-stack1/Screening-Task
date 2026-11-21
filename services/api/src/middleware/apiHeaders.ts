import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

/**
 * API responses can contain tokens and personal data: forbid storage in any browser, proxy or
 * HTTP cache.
 */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Rejects request bodies that are not JSON (415). Without this, express.json() silently ignores
 * e.g. form-encoded bodies and the request fails later with a less clear validation error.
 */
export function requireJsonBody(req: Request, _res: Response, next: NextFunction) {
  const hasBody =
    req.headers['transfer-encoding'] !== undefined ||
    (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');
  if (BODY_METHODS.has(req.method) && hasBody && !req.is('application/json')) {
    next(AppError.unsupportedMediaType());
    return;
  }
  next();
}
