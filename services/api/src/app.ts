import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { isDatabaseReachable, prisma } from './config/database';
import { env } from './config/env';
import { authConfig } from './config/security';
import { aiServiceClient } from './integrations/ai-service/aiServiceClient';
import { noStore, requireJsonBody } from './middleware/apiHeaders';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { createApiRouter, type ApiRouterDependencies } from './routes';

/** Maximum JSON body size. File uploads will get their own, separately limited route. */
export const JSON_BODY_LIMIT = '1mb';

export type AppDependencies = ApiRouterDependencies;

function defaultDependencies(): AppDependencies {
  return {
    health: {
      checkDatabase: isDatabaseReachable,
      checkAiService: () => aiServiceClient.getStatus(),
    },
    auth: { db: prisma, config: authConfig },
  };
}

/**
 * Builds the Express application (no network listening here, so it can be
 * imported by tests without opening a port). Any dependency can be replaced in tests;
 * the Prisma client only connects when a query actually runs.
 */
export function createApp(overrides: Partial<AppDependencies> = {}): Express {
  const deps: AppDependencies = { ...defaultDependencies(), ...overrides };
  const app = express();

  app.disable('x-powered-by');
  // Correct client IPs (rate limiting) behind a known number of reverse proxies only.
  app.set('trust proxy', env.TRUST_PROXY_HOPS > 0 ? env.TRUST_PROXY_HOPS : false);
  app.use(helmet());
  app.use(
    cors({
      // Requests without an Origin header (native mobile apps, curl) are allowed;
      // browser origins must be listed in CORS_ORIGINS. CORS is not an auth control.
      origin: (origin, callback) => {
        callback(null, !origin || env.CORS_ORIGINS.includes(origin));
      },
    }),
  );
  app.use(requestId);
  app.use(requestLogger);
  app.use(noStore);
  app.use(requireJsonBody);
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use('/api/v1', createApiRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
