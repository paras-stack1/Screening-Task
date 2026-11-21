/** Used when a token cannot be decoded: short, so the app refreshes early rather than late. */
export const FALLBACK_ACCESS_LIFETIME_MS = 5 * 60 * 1000;

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

/**
 * Lifetime of an access token in milliseconds, from its own `exp - iat` claims.
 *
 * Why not use `accessTokenExpiresAt` directly: budget phones often have a wrong clock, and comparing
 * a server timestamp with the device clock would make the app refresh constantly (clock ahead) or
 * send expired tokens (clock behind). The lifetime is clock-independent; the app adds it to the
 * moment it received the token. The token is NOT verified here - only the API verifies tokens -
 * and its claims are never used for any decision other than timing.
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
