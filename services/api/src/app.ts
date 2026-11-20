import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { isDatabaseReachable } from './config/database';
import { env } from './config/env';
import { aiServiceClient } from './integrations/ai-service/aiServiceClient';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { createApiRouter, type ApiRouterDependencies } from './routes';

/** Maximum JSON body size. File uploads will get their own, separately limited route. */
export const JSON_BODY_LIMIT = '1mb';

export type AppDependencies = ApiRouterDependencies;

const defaultDependencies: AppDependencies = {
  health: {
    checkDatabase: isDatabaseReachable,
    checkAiService: () => aiServiceClient.getStatus(),
  },
};

/**
 * Builds the Express application (no network listening here, so it can be
 * imported by tests without opening a port). Dependencies can be replaced in tests.
 */
export function createApp(deps: AppDependencies = defaultDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
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
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use('/api/v1', createApiRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
