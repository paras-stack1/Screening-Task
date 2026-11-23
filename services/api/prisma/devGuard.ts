/**
 * Guard for DEVELOPMENT-ONLY scripts (db:dev-live-worker, db:dev-reset-password) - security
 * review PE-2. They change accounts directly, so they refuse to run unless:
 *  - NODE_ENV is not "production", AND
 *  - DATABASE_URL points at a database on this computer (localhost / 127.0.0.1 / ::1).
 * The second rule protects a shared or production database even when NODE_ENV was not set.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function devScriptRefusal(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === 'production') return 'Refusing to run in production';
  const raw = env.DATABASE_URL;
  if (!raw) return 'DATABASE_URL is not set';
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return 'DATABASE_URL is not a valid URL';
  }
  if (!LOCAL_HOSTS.has(host)) {
    return 'Refusing to run: development scripts only work on a database on this computer (localhost)';
  }
  return null;
}

export function assertDevelopmentDatabase(env: Record<string, string | undefined> = process.env): void {
  const refusal = devScriptRefusal(env);
  if (refusal) throw new Error(refusal);
}
