import { Prisma } from '@prisma/client';
import type { LogMeta } from './logger';

/**
 * Turns an unknown error into log-safe metadata.
 *
 * Prisma error messages can embed query arguments (e.g. a child's name in a
 * `where` clause), so for Prisma errors only the error type and code are logged,
 * never the message or stack (a stack's first line repeats the message).
 */
export function describeError(error: unknown): LogMeta {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      errorType: 'PrismaClientKnownRequestError',
      prismaCode: error.code,
      model: error.meta?.modelName,
    };
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return { errorType: 'PrismaClientInitializationError', prismaCode: error.errorCode };
  }
  if (
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return { errorType: error.name };
  }
  if (error instanceof Error) {
    return { errorType: error.name, message: error.message, stack: error.stack };
  }
  return { errorType: typeof error };
}
