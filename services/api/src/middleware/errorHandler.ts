import type { ApiError } from '@balswasthya/shared-contracts';
import { Prisma } from '@prisma/client';
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
 * Database failures a client can act on. Services handle the expected cases themselves (e.g. a
 * duplicate link); this is the safety net for races they could not foresee - the response is a
 * clear 409/503 instead of a 500, and never contains SQL or field values.
 */
function mapDatabaseError(
  err: unknown,
): { status: number; code: string; message: string; prismaCode: string } | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return {
          status: 409,
          code: 'CONFLICT',
          message: 'This change conflicts with an existing record. Reload and try again.',
          prismaCode: err.code,
        };
      case 'P2034':
        return {
          status: 409,
          code: 'TRANSACTION_CONFLICT',
          message: 'Another change happened at the same time. Please try again.',
          prismaCode: err.code,
        };
      case 'P1001':
      case 'P1002':
      case 'P1017':
      case 'P2024':
      case 'P2028':
        return {
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'The service is temporarily unavailable. Please try again.',
          prismaCode: err.code,
        };
      default:
        return null;
    }
  }
  // Database triggers and CHECK constraints (e.g. the Step 6 screening integrity rules) surface as
  // unknown request errors carrying the PostgreSQL SQLSTATE. Services check these rules first;
  // this only answers a missed case clearly. The database text is never sent to the client.
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    if (err.message.includes('code: "23514"')) {
      return {
        status: 409,
        code: 'INTEGRITY_RULE_VIOLATION',
        message: 'This change is not allowed by a data-integrity rule. Reload and try again.',
        prismaCode: 'SQLSTATE_23514',
      };
    }
    if (err.message.includes('code: "40001"')) {
      return {
        status: 409,
        code: 'TRANSACTION_CONFLICT',
        message: 'Another change happened at the same time. Please try again.',
        prismaCode: 'SQLSTATE_40001',
      };
    }
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again.',
      prismaCode: err.errorCode ?? 'INIT',
    };
  }
  return null;
}

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

  const dbError = mapDatabaseError(err);
  if (dbError) {
    // Code only: Prisma messages can contain field values (personal data).
    logger.warn('database_error', { requestId, prismaCode: dbError.prismaCode });
    res.status(dbError.status).json({ error: { code: dbError.code, message: dbError.message, requestId } });
    return;
  }

  logger.error('unhandled_error', { requestId, ...describeError(err) });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId },
  });
}
