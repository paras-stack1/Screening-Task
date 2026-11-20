import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { getRequestId } from './requestId';

/** Logs method, path, status and duration only - never bodies or query strings (may contain PII). */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.info('request', {
      requestId: getRequestId(res),
      method: req.method,
      // originalUrl keeps the mount prefix (/api/v1/...); strip the query string.
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });
  next();
}
