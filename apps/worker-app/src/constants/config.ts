/**
 * Public, client-side configuration.
 *
 * SECURITY: anything prefixed EXPO_PUBLIC_ is bundled into the app and is visible
 * to anyone who downloads it. Only put non-secret values here (e.g. the API URL).
 * Database credentials, JWT secrets and AI service keys live ONLY in services/api/.env.
 */
const DEFAULT_API_BASE_URL = 'http://localhost:4000/api/v1';

export const appConfig = {
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, ''),
  requestTimeoutMs: 10_000,
} as const;
