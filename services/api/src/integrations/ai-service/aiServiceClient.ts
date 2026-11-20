import { aiServiceHealthSchema, type DependencyStatus } from '@balswasthya/shared-contracts';
import { env } from '../../config/env';

/**
 * Adapter for the separately owned Python AI service.
 *
 * This is the ONLY place in the backend that knows the AI service's URL and key.
 * Modules (e.g. screening) will call functions exported from here, so when the AI
 * team's real endpoints arrive, only this file and the shared contract change.
 *
 * Design rules:
 *  - Every call has a timeout.
 *  - Failure is never fatal: callers get "unavailable" and the screening
 *    questionnaire flow continues without AI support.
 *  - No AI result is ever invented here.
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env.AI_SERVICE_API_KEY) {
    headers['X-API-Key'] = env.AI_SERVICE_API_KEY;
  }
  return headers;
}

export function isAiServiceConfigured(): boolean {
  return env.AI_SERVICE_URL.length > 0;
}

export async function getAiServiceStatus(): Promise<DependencyStatus> {
  if (!isAiServiceConfigured()) return 'not_configured';

  try {
    const response = await fetch(`${env.AI_SERVICE_URL}/health`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(env.AI_SERVICE_TIMEOUT_MS),
    });
    if (!response.ok) return 'down';
    const parsed = aiServiceHealthSchema.safeParse(await response.json());
    return parsed.success ? 'up' : 'down';
  } catch {
    return 'down';
  }
}
