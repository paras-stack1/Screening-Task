import { Router } from 'express';
import { healthRouter } from './health.routes';

/**
 * Versioned API router mounted at /api/v1.
 * Each feature module will export its own router and be registered here, e.g.
 *   apiRouter.use('/auth', authRouter);
 *   apiRouter.use('/children', childrenRouter);
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
