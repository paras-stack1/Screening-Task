/**
 * Public client configuration (docs/frontend/configuration.md).
 *
 * SECURITY: every EXPO_PUBLIC_* value is compiled into the app and readable by anyone who installs
 * it. Only non-secret values belong here. Database URLs, JWT secrets and AI keys live only in
 * services/api/.env.
 */

/** Development fallback only (decision J). Production builds must set EXPO_PUBLIC_API_BASE_URL. */
export const DEV_DEFAULT_API_BASE_URL = 'http://localhost:4000/api/v1';

export type ConfigProblem = 'missingApiUrl' | 'invalidApiUrl' | 'insecureApiUrl';

export type ApiUrlResult = { ok: true; url: string } | { ok: false; problem: ConfigProblem };

/**
 * Validates the API base URL. In production (non-development) builds the URL is required and must
 * use HTTPS; plain HTTP is allowed only in development (local API, emulator, LAN phone).
 */
export function resolveApiBaseUrl(raw: string | undefined, isDevelopment: boolean): ApiUrlResult {
  const value = raw?.trim() || (isDevelopment ? DEV_DEFAULT_API_BASE_URL : '');
  if (!value) return { ok: false, problem: 'missingApiUrl' };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, problem: 'invalidApiUrl' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    return { ok: false, problem: 'invalidApiUrl' };
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    // Credentials or query strings in the base URL would leak into every request.
    return { ok: false, problem: 'invalidApiUrl' };
  }
  if (!isDevelopment && parsed.protocol !== 'https:') return { ok: false, problem: 'insecureApiUrl' };

  return { ok: true, url: value.replace(/\/+$/, '') };
}

export interface AppConfig {
  api: ApiUrlResult;
  /** Generous: field networks are slow. Login with Argon2 verification also takes time. */
  requestTimeoutMs: number;
}

export const appConfig: AppConfig = {
  api: resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
  requestTimeoutMs: 20_000,
};
