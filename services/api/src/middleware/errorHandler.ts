import type { ApiError } from '@balswasthya/shared-contracts';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { describeError } from '../utils/describeError';
import { logger } from '../utils/logger';
import { getRequestId } from './requestId';

/** 404 for any route that did not match. The path is not echoed back to the caller. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound('Route not found'));
}

/**
 * Errors raised by express.json() (body-parser) carry an HTTP status and a `type`.
 * Mapping them here prevents client mistakes (e.g. an oversized body) from
 * surfacing as 500 Internal Server Error.
 */
interface BodyParserError {
  status: number;
  type: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'type' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500 &&
    typeof error.type === 'string'
  );
}

const BODY_PARSER_ERRORS: Record<string, { code: string; message: string }> = {
  'entity.parse.failed': { code: 'INVALID_JSON', message: 'Malformed JSON body' },
  'entity.too.large': { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
  'encoding.unsupported': { code: 'UNSUPPORTED_ENCODING', message: 'Unsupported content encoding' },
  'charset.unsupported': { code: 'UNSUPPORTED_CHARSET', message: 'Unsupported charset' },
};

/**
 * Global error handler. Always responds with the shared ApiError shape.
 * Internal details (stack traces, SQL errors) are logged, never sent to the client.
 */
export function errorHandler(err: unknown, _req: Request, res: Response<ApiError>, _next: NextFunction) {
  const requestId = getRequestId(res);

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

  if (isBodyParserError(err)) {
    const known = BODY_PARSER_ERRORS[err.type] ?? { code: 'BAD_REQUEST', message: 'Invalid request body' };
    res.status(err.status).json({ error: { ...known, requestId } });
    return;
  }

  logger.error('unhandled_error', { requestId, ...describeError(err) });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId },
  });
}
