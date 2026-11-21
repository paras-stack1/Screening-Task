import { PrismaClient, type Prisma } from '@prisma/client';
import { isProduction } from './env';

/** The shared client or a transaction client - for functions that work in both. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Single shared Prisma client for the whole process (Prisma manages its own
 * connection pool). Query logging is off by default so child health data never
 * ends up in log files.
 */
export const prisma = new PrismaClient({
  log: isProduction ? ['error'] : ['warn', 'error'],
});

/** Lightweight connectivity probe used by the readiness endpoint. */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
