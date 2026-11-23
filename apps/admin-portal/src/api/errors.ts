/**
 * Every failed API call becomes an ApiError. Its `message` is for developers only and never holds
 * tokens, passwords or response bodies; screens show a translated message chosen from
 * kind / status / code (see errorMessageKey in ../i18n).
 */
export type ApiErrorKind =
  /** No response: offline, DNS failure, connection refused, CORS refusal. */
  | 'network'
  | 'timeout'
  | 'cancelled'
  /** The server answered with a non-2xx status. */
  | 'http'
  /** 2xx, but the body does not match the shared contract. */
  | 'invalidResponse'
  /** No usable API address was configured at build time. */
  | 'notConfigured'
  /** An authenticated call without a session. */
  | 'noSession';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
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

/** No response arrived. */
export function isConnectivityError(error: unknown): boolean {
  return isApiError(error) && (error.kind === 'network' || error.kind === 'timeout');
}

/** The server answered with this HTTP status. */
export function hasStatus(error: unknown, status: number): boolean {
  return isApiError(error) && error.kind === 'http' && error.status === status;
}

/** `details.rule` of a policy error, e.g. TOO_SHORT. */
export function errorRule(error: unknown): string | undefined {
  if (!isApiError(error) || typeof error.details !== 'object' || error.details === null) return undefined;
  const rule = (error.details as Record<string, unknown>).rule;
  return typeof rule === 'string' ? rule : undefined;
}
