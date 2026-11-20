import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['up', 'down', 'not_configured']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

/** Response of GET /api/v1/health (liveness: is the process running). */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  timestamp: z.string(),
  uptimeSeconds: z.number(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Response of GET /api/v1/health/ready (readiness: are dependencies reachable). */
export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded', 'unavailable']),
  service: z.string(),
  timestamp: z.string(),
  dependencies: z.object({
    database: dependencyStatusSchema,
    /**
     * The AI service is OPTIONAL. If it is down, the API stays "ready"
     * (or "degraded") and screening questionnaires keep working.
     */
    aiService: dependencyStatusSchema,
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
