/** Used when a token cannot be decoded: short, so the portal refreshes early rather than late. */
export const FALLBACK_ACCESS_LIFETIME_MS = 5 * 60 * 1000;

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

/**
 * Lifetime of an access token from its own `exp - iat` claims, so a wrong computer clock does not
 * matter. The token is NOT verified here (only the API verifies tokens), and its claims are used
 * for timing only.
 */
export function accessTokenLifetimeMs(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return FALLBACK_ACCESS_LIFETIME_MS;
    const claims = JSON.parse(base64UrlDecode(payload)) as { exp?: unknown; iat?: unknown };
    if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') return FALLBACK_ACCESS_LIFETIME_MS;
    const lifetime = (claims.exp - claims.iat) * 1000;
    return lifetime > 0 && lifetime <= 24 * 60 * 60 * 1000 ? lifetime : FALLBACK_ACCESS_LIFETIME_MS;
  } catch {
    return FALLBACK_ACCESS_LIFETIME_MS;
  }
}
