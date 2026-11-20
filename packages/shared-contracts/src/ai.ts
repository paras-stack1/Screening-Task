import { z } from 'zod';

/**
 * Contract for the separately owned Python AI service.
 *
 * Only the health contract is defined in Step 1. Screening-support request/response
 * schemas will be agreed with the AI team later and added here, so the API and the
 * AI service validate against one source of truth.
 *
 * Product safety: AI output is screening SUPPORT only, never a diagnosis. Any
 * future result schema must carry a disclaimer and model version, and the app
 * must keep working without it.
 */
export const aiServiceHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('ai-service'),
  version: z.string(),
  modelsLoaded: z.boolean(),
});
export type AiServiceHealth = z.infer<typeof aiServiceHealthSchema>;
