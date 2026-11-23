/**
 * Validates the API base URL (no browser globals here: also used by vite.config.ts at build time).
 * Must be absolute, end in /api/v1, carry no credentials, query or fragment, and use https in
 * production. Missing in development = http://localhost:4000/api/v1; invalid = null.
 */
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
