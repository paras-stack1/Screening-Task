/**
 * Every failure of an API call becomes an ApiError. Its `message` is for developers only and never
 * contains tokens, passwords or response bodies; screens show a translated message chosen from
 * `kind` / `status` / `code` (see apiErrorMessageKey).
 */
export type ApiErrorKind =
  /** No response: offline, DNS failure, connection refused, TLS failure. */
  | 'network'
  /** No response within the time limit. */
  | 'timeout'
  /** Cancelled by the caller (screen closed, newer request). Not shown to users. */
  | 'cancelled'
  /** The server answered with a non-2xx status. */
  | 'http'
  /** 2xx but the body does not match the shared contract. */
  | 'invalidResponse'
  /** The app has no usable API configuration, or no session for an authenticated call. */
  | 'notConfigured'
  | 'noSession';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** Error code from the API envelope, e.g. INVALID_CREDENTIALS. */
  readonly code?: string;
  /** Server request id for support/log correlation. Safe to show. */
  readonly requestId?: string;
  /** Envelope `details` (e.g. `{ rule: 'TOO_SHORT' }`). Never contains secrets. */
  readonly details?: unknown;

  constructor(
    kind: ApiErrorKind,
    init: { status?: number; code?: string; requestId?: string; details?: unknown; cause?: unknown } = {},
  ) {
    super(
      `API ${kind}${init.status ? ` ${init.status}` : ''}${init.code ? ` ${init.code}` : ''}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = 'ApiError';
    this.kind = kind;
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** True when no response arrived - the request may be retried if it is safe to repeat. */
export function isConnectivityError(error: unknown): boolean {
  return isApiError(error) && (error.kind === 'network' || error.kind === 'timeout');
}

/** Errors worth retrying automatically for SAFE (GET) requests: no response, or a server fault. */
export function isRetryableError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (isConnectivityError(error)) return true;
  return error.kind === 'http' && (error.status ?? 0) >= 500;
}

export function errorRule(error: unknown): string | undefined {
  if (!isApiError(error) || typeof error.details !== 'object' || error.details === null) return undefined;
  const rule = (error.details as Record<string, unknown>).rule;
  return typeof rule === 'string' ? rule : undefined;
}
