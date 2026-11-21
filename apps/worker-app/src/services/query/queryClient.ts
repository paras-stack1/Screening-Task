import { QueryClient } from '@tanstack/react-query';
import { isRetryableError } from '../api/errors';

/** Automatic retries for safe reads only. Writes (mutations) are never retried automatically. */
export const MAX_QUERY_RETRIES = 2;

/**
 * Server-state cache. Holds data in memory only (nothing is persisted to the device in this
 * phase) and is cleared whenever a session ends, so one worker never sees another's data.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => failureCount < MAX_QUERY_RETRIES && isRetryableError(error),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
