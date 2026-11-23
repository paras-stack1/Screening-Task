import { apiErrorSchema, WEB_CLIENT_HEADER, WEB_CLIENT_VALUE } from '@balswasthya/shared-contracts';
import type { ZodType } from 'zod';
import { ApiError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface HttpRequest<T> {
  method: HttpMethod;
  /** Path below the API base URL, starting with '/'. Never put tokens or personal data here. */
  path: string;
  body?: unknown;
  /** Response contract. Omit for 204 responses. */
  schema?: ZodType<T>;
  accessToken?: string;
  /**
   * Send cookies (only the /auth/web/* endpoints need them: the refresh cookie is scoped to that
   * path). Every other call is made without credentials.
   */
  withSessionCookie?: boolean;
  signal?: AbortSignal;
}

export type HttpRequestFn = <T = undefined>(request: HttpRequest<T>) => Promise<T>;

export interface HttpOptions {
  baseUrl: string | null;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Correlation id in the API's accepted format (/^[A-Za-z0-9-]{8,64}$/). Not a secret. */
export function createRequestId(): string {
  const random = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  return `adm-${Date.now().toString(36)}-${random}`;
}

/** Low-level JSON over HTTP(S). Knows nothing about sessions. Never logs anything. */
export function createHttp({
  baseUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn = (...args) => fetch(...args),
}: HttpOptions): HttpRequestFn {
  return async function request<T>({
    method,
    path,
    body,
    schema,
    accessToken,
    withSessionCookie = false,
    signal,
  }: HttpRequest<T>): Promise<T> {
    if (!baseUrl) throw new ApiError('notConfigured');
    if (signal?.aborted) throw new ApiError('cancelled');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort);

    const headers: Record<string, string> = { Accept: 'application/json', 'X-Request-Id': createRequestId() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (withSessionCookie) headers[WEB_CLIENT_HEADER] = WEB_CLIENT_VALUE;

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: withSessionCookie ? 'include' : 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) throw new ApiError('timeout', { cause });
      if (signal?.aborted) throw new ApiError('cancelled', { cause });
      throw new ApiError('network', { cause });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    const text = await response.text().catch(() => '');
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!response.ok) {
      const envelope = apiErrorSchema.safeParse(json);
      throw new ApiError('http', {
        status: response.status,
        code: envelope.success ? envelope.data.error.code : undefined,
        details: envelope.success ? envelope.data.error.details : undefined,
        requestId: (envelope.success ? envelope.data.error.requestId : undefined) ?? requestId,
      });
    }

    if (!schema) return undefined as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError('invalidResponse', { status: response.status, requestId });
    return parsed.data;
  };
}
