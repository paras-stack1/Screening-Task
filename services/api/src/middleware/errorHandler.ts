import type { ApiError } from '@balswasthya/shared-contracts';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

/** 404 for any route that did not match. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.path}`));
}

/**
 * Global error handler. Always responds with the shared ApiError shape.
 * Internal details (stack traces, SQL errors) are logged, never sent to the client.
 */
export function errorHandler(err: unknown, _req: Request, res: Response<ApiError>, _next: NextFunction) {
  const requestId = res.locals.requestId as string | undefined;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        requestId,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details, requestId },
    });
    return;
  }

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body', requestId } });
    return;
  }

  logger.error('unhandled_error', {
    requestId,
    name: err instanceof Error ? err.name : 'Unknown',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId },
  });
}
