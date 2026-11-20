import { createApp } from './app';
import { prisma } from './config/database';
import { env } from './config/env';
import { logger } from './utils/logger';

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info('api_started', { url: `http://localhost:${env.PORT}/api/v1/health`, env: env.NODE_ENV });
});

server.on('error', (error: NodeJS.ErrnoException) => {
  logger.error('api_listen_failed', { code: error.code, message: error.message });
  process.exit(1);
});

/** Graceful shutdown: stop accepting requests, then close DB connections. */
async function shutdown(signal: string) {
  logger.info('api_shutting_down', { signal });
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
