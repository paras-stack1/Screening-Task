import { apiErrorSchema } from '@balswasthya/shared-contracts';
import type { ZodType } from 'zod';
import { appConfig } from '../constants/config';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Minimal typed HTTP client. Every response is validated against a shared Zod
 * contract, so a backend change that breaks the contract fails loudly here.
 * The app talks ONLY to the Express API - never directly to the AI service.
 */
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.requestTimeoutMs);

  try {
    const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const parsedError = apiErrorSchema.safeParse(body);
      throw new ApiRequestError(
        parsedError.success ? parsedError.data.error.message : `Request failed (${response.status})`,
        response.status,
        parsedError.success ? parsedError.data.error.code : undefined,
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiRequestError('Unexpected response from server');
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiRequestError('Request timed out');
    }
    throw new ApiRequestError('Network error - server not reachable');
  } finally {
    clearTimeout(timeout);
  }
}
