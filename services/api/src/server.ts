import { createApp } from './app';
import { prisma } from './config/database';
import { env } from './config/env';
import { describeError } from './utils/describeError';
import { logger } from './utils/logger';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info('api_started', { url: `http://localhost:${env.PORT}/api/v1/health`, env: env.NODE_ENV });
});

server.on('error', (error: NodeJS.ErrnoException) => {
  logger.fatal('api_listen_failed', { code: error.code, message: error.message });
  process.exit(1);
});

let shuttingDown = false;

/** Graceful shutdown: stop accepting requests, then close DB connections. */
function shutdown(reason: string, exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('api_shutting_down', { reason });

  server.close(() => {
    prisma
      .$disconnect()
      .catch((error: unknown) => logger.error('db_disconnect_failed', describeError(error)))
      .finally(() => process.exit(exitCode));
  });
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(exitCode || 1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));

// A rejected promise nobody handled means state may be inconsistent: log and restart cleanly.
process.on('unhandledRejection', (reason) => {
  logger.fatal('unhandled_rejection', describeError(reason));
  shutdown('unhandledRejection', 1);
});

// After an uncaught exception the process state is unknown: exit immediately.
process.on('uncaughtException', (error) => {
  logger.fatal('uncaught_exception', describeError(error));
  process.exit(1);
});
