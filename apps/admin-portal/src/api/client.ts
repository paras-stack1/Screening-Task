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
 * The single client for authenticated API calls (stages PC/PD build on it). Pages never call
 * fetch directly. Writes are never retried automatically.
 */
export interface ApiClient {
  get<T>(path: string, schema: ZodType<T>, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, schema?: ZodType<T>, options?: RequestOptions): Promise<T>;
}

export function createApiClient(request: HttpRequestFn, session: AuthorizedCaller): ApiClient {
  return {
    get: (path, schema, options) =>
      session.authorized((accessToken) =>
        request({ method: 'GET', path, schema, accessToken, signal: options?.signal }),
      ),
    post: (path, body, schema, options) =>
      session.authorized((accessToken) =>
        request({ method: 'POST', path, body, schema, accessToken, signal: options?.signal }),
      ),
  };
}
