import { Platform } from 'react-native';

/**
 * Public client configuration. Every EXPO_PUBLIC_* value is compiled into the app and readable by
 * anyone: only the API address belongs here, never a secret.
 */
export const DEV_DEFAULT_API_BASE_URL = 'http://localhost:4000/api/v1';

export type ApiUrlResult =
  { ok: true; url: string } | { ok: false; problem: 'missing' | 'invalid' | 'insecure' };

/** Production builds require HTTPS; plain HTTP only in development. */
export function resolveApiBaseUrl(raw: string | undefined, isDevelopment: boolean): ApiUrlResult {
  const value = raw?.trim() || (isDevelopment ? DEV_DEFAULT_API_BASE_URL : '');
  if (!value) return { ok: false, problem: 'missing' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, problem: 'invalid' };
  }
  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return { ok: false, problem: 'invalid' };
  }
  if (!isDevelopment && parsed.protocol !== 'https:') return { ok: false, problem: 'insecure' };
  return { ok: true, url: value.replace(/\/+$/, '') };
}

export const appConfig = {
  api: resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
  requestTimeoutMs: 20_000,
  /**
   * Browser: the refresh token lives in an httpOnly cookie (API /parent/auth/web/*), never in
   * script-readable storage. Android: it is kept in SecureStore.
   */
  isWeb: Platform.OS === 'web',
};
