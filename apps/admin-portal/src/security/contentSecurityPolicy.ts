/**
 * Content-Security-Policy for the BUILT portal (security review PE-1). Added to index.html at
 * build time by vite.config.ts (the development server needs inline scripts for hot reload, so
 * the policy is not applied there).
 *
 * The page may only run its own scripts and styles, and may only talk to the configured API.
 * Even if some text were ever rendered as HTML by mistake, injected script could not run, and
 * nothing could be sent to another server.
 *
 * A <meta> policy cannot set `frame-ancestors`; the web server must send
 * `Content-Security-Policy: frame-ancestors 'none'` (and `X-Frame-Options: DENY`) as headers -
 * see docs/admin-portal/security-review.md.
 */
export function contentSecurityPolicy(apiBaseUrl: string | null): string {
  const apiOrigin = apiBaseUrl ? new URL(apiBaseUrl).origin : null;
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${apiOrigin ?? "'none'"}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}
