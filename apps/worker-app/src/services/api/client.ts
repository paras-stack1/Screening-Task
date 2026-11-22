import type { ZodType } from 'zod';
import type { HttpRequestFn } from './http';

/** What the API client needs from the session: an authorised call with one refresh-and-retry. */
export interface AuthorizedCaller {
  authorized<T>(call: (accessToken: string) => Promise<T>): Promise<T>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * The single client for authenticated API calls. Screens never call fetch directly; feature
 * services use this client, and TanStack Query hooks use the feature services.
 *
 * Writes are never retried automatically. Create requests that may be retried by the user carry a
 * `clientOperationId`, so the API can answer a repeat with the first result.
 */
export interface ApiClient {
  get<T>(path: string, schema: ZodType<T>, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, schema?: ZodType<T>, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body: unknown, schema?: ZodType<T>, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, body: unknown, schema?: ZodType<T>, options?: RequestOptions): Promise<T>;
}

export function createApiClient(request: HttpRequestFn, session: AuthorizedCaller): ApiClient {
  const write =
    (method: 'POST' | 'PATCH' | 'DELETE') =>
    <T>(path: string, body: unknown, schema?: ZodType<T>, options?: RequestOptions) =>
      session.authorized((accessToken) =>
        request({ method, path, body, schema, accessToken, signal: options?.signal }),
      );
  return {
    get: (path, schema, options) =>
      session.authorized((accessToken) =>
        request({ method: 'GET', path, schema, accessToken, signal: options?.signal }),
      ),
    post: write('POST'),
    patch: write('PATCH'),
    delete: write('DELETE'),
  };
}
