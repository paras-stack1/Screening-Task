/**
 * Build-time configuration (VITE_* values are public: they are inside the page). Validated once;
 * an invalid value makes every API call fail with a clear "not configured" error instead of
 * silently calling a wrong address.
 */
export interface PortalConfig {
  /** Absolute API base URL ending in /api/v1, or null when missing/invalid. */
  apiBaseUrl: string | null;
}

export function parseApiBaseUrl(raw: string | undefined, production: boolean): string | null {
  const value = raw?.trim();
  if (!value) return production ? null : 'http://localhost:4000/api/v1';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) return null;
  if (url.search || url.hash || url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/api/v1')) return null;
  return `${url.origin}${path}`;
}

export const config: PortalConfig = {
  apiBaseUrl: parseApiBaseUrl(import.meta.env.VITE_API_BASE_URL as string | undefined, import.meta.env.PROD),
};
