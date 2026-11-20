import { aiServiceHealthSchema, type DependencyStatus } from '@balswasthya/shared-contracts';
import { env } from '../../config/env';
import { readJsonWithLimit } from '../../utils/http';

/**
 * Adapter for the separately owned Python AI service.
 *
 * This is the ONLY place in the backend that knows the AI service's URL and key.
 * Modules (e.g. screening) will call functions exported from here, so when the AI
 * team's real endpoints arrive, only this file and the shared contract change.
 *
 * Design rules:
 *  - Every call has a timeout and a maximum response size.
 *  - Failure is never fatal: callers get "unavailable" and the screening
 *    questionnaire flow continues without AI support.
 *  - No AI result is ever invented here.
 */
export interface AiServiceConfig {
  /** Base URL without trailing slash; empty string = not configured. */
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxResponseBytes?: number;
}

/** Generous for JSON results; media is never returned inline by the AI service. */
export const DEFAULT_AI_MAX_RESPONSE_BYTES = 1_000_000;

export interface AiServiceClient {
  isConfigured(): boolean;
  getStatus(): Promise<DependencyStatus>;
}

export function createAiServiceClient(config: AiServiceConfig): AiServiceClient {
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_AI_MAX_RESPONSE_BYTES;

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.apiKey) {
      headers['X-API-Key'] = config.apiKey;
    }
    return headers;
  }

  const isConfigured = () => config.baseUrl.length > 0;

  async function getStatus(): Promise<DependencyStatus> {
    if (!isConfigured()) return 'not_configured';

    try {
      const response = await fetch(`${config.baseUrl}/health`, {
        headers: buildHeaders(),
        signal: AbortSignal.timeout(config.timeoutMs),
        redirect: 'error', // never follow redirects to an unexpected host
      });
      if (!response.ok) {
        await response.body?.cancel();
        return 'down';
      }
      const parsed = aiServiceHealthSchema.safeParse(await readJsonWithLimit(response, maxResponseBytes));
      return parsed.success ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  return { isConfigured, getStatus };
}

/** Process-wide client built from validated environment configuration. */
export const aiServiceClient = createAiServiceClient({
  baseUrl: env.AI_SERVICE_URL,
  apiKey: env.AI_SERVICE_API_KEY,
  timeoutMs: env.AI_SERVICE_TIMEOUT_MS,
});
