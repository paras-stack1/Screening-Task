import { apiErrorSchema } from '@balswasthya/shared-contracts';
import type { ZodType } from 'zod';

/**
 * Every failure of an API call becomes an ApiError. Its message never contains tokens, codes,
 * passwords or response bodies; screens pick a translated text from `code` / `kind`.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'invalidResponse' | 'notConfigured';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly init: { status?: number; code?: string; details?: unknown } = {},
  ) {
    super(`API ${kind}${init.status ? ` ${init.status}` : ''}${init.code ? ` ${init.code}` : ''}`);
    this.name = 'ApiError';
  }
  get status() {
    return this.init.status;
  }
  get code() {
    return this.init.code;
  }
  get details() {
    return this.init.details;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export interface HttpRequest<T> {
  method: 'GET' | 'POST';
  /** Path below the API base URL. Never put tokens or personal data in it. */
  path: string;
  body?: unknown;
  schema?: ZodType<T>;
  accessToken?: string;
  /** Browser cookie routes: send the httpOnly cookie and the portal header. */
  web?: boolean;
}

export type Http = <T = undefined>(request: HttpRequest<T>) => Promise<T>;

export const WEB_CLIENT_HEADER = 'x-balswasthya-client';
export const WEB_CLIENT_VALUE = 'parent-portal';

/** JSON over HTTPS. Never logs. */
export function createHttp(options: {
  baseUrl: string | null;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}): Http {
  const fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
  return async function request<T>({
    method,
    path,
    body,
    schema,
    accessToken,
    web,
  }: HttpRequest<T>): Promise<T> {
    if (!options.baseUrl) throw new ApiError('notConfigured');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (web) headers[WEB_CLIENT_HEADER] = WEB_CLIENT_VALUE;
    let response: Response;
    try {
      response = await fetchFn(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        ...(web && { credentials: 'include' as const }),
      });
    } catch {
      throw new ApiError(timedOut ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text().catch(() => '');
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const envelope = apiErrorSchema.safeParse(json);
      throw new ApiError('http', {
        status: response.status,
        code: envelope.success ? envelope.data.error.code : undefined,
        details: envelope.success ? envelope.data.error.details : undefined,
      });
    }
    if (!schema) return undefined as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError('invalidResponse', { status: response.status });
    return parsed.data;
  };
}
