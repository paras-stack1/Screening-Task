import { createPiiCrypto, type PiiCrypto } from '../utils/piiCrypto';
import { env, type Env } from './env';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * All authentication parameters in one place (docs/authentication.md). Built from the validated
 * environment; tests build their own with `buildAuthConfig` to use short lifetimes.
 */
export interface AuthConfig {
  jwt: {
    /** HS256 key bytes. Never logged, never sent to the client. */
    secret: Uint8Array;
    issuer: string;
    audience: string;
    accessTokenTtlSeconds: number;
  };
  refresh: {
    /** A session unused for this long expires. Each refresh extends it, up to the absolute limit. */
    idleTtlMs: number;
    /** Hard limit from the original sign-in; the user must then sign in again. */
    absoluteTtlMs: number;
    /**
     * Decision B: if a just-rotated token is presented again within this window and its
     * replacement has never been used, the replacement is superseded instead of revoking the
     * session (covers a lost refresh response on a poor mobile network). Any other reuse revokes
     * the whole session family.
     */
    reuseGraceMs: number;
  };
  login: {
    /** Failed attempts before a temporary lock. */
    maxFailedAttempts: number;
    /** First lock duration; doubles with each further failure, up to lockoutMaxMs. Never permanent. */
    lockoutBaseMs: number;
    lockoutMaxMs: number;
  };
}

export function buildAuthConfig(source: Env): AuthConfig {
  return {
    jwt: {
      secret: new TextEncoder().encode(source.JWT_SECRET),
      issuer: source.JWT_ISSUER ?? `balswasthya-api:${source.NODE_ENV}`,
      audience: source.JWT_AUDIENCE,
      accessTokenTtlSeconds: source.ACCESS_TOKEN_TTL_SECONDS,
    },
    refresh: {
      idleTtlMs: source.REFRESH_TOKEN_IDLE_DAYS * DAY_MS,
      absoluteTtlMs: source.REFRESH_TOKEN_ABSOLUTE_DAYS * DAY_MS,
      reuseGraceMs: 30_000,
    },
    login: {
      maxFailedAttempts: 5,
      lockoutBaseMs: MINUTE_MS,
      lockoutMaxMs: 15 * MINUTE_MS,
    },
  };
}

export const authConfig: AuthConfig = buildAuthConfig(env);

/**
 * Parent Portal sessions (Step 8, PP2/PP9): same signing key and rules as staff, but a separate
 * audience (staff routes reject parent tokens and vice versa) and longer refresh lifetimes, since
 * parents sign in rarely: 30 days idle, 90 days absolute. Access tokens stay at the staff value.
 */
export function buildParentAuthConfig(source: Env): AuthConfig {
  const base = buildAuthConfig(source);
  return {
    ...base,
    jwt: { ...base.jwt, audience: source.PARENT_JWT_AUDIENCE },
    refresh: { idleTtlMs: 30 * DAY_MS, absoluteTtlMs: 90 * DAY_MS, reuseGraceMs: 30_000 },
  };
}

export const parentAuthConfig: AuthConfig = buildParentAuthConfig(env);

/** Guardian phone encryption + lookup hashing with the configured keys (may be unavailable outside production). */
export const piiCrypto: PiiCrypto = createPiiCrypto({
  encryptionKey: env.PII_ENCRYPTION_KEY,
  lookupKey: env.PII_LOOKUP_KEY,
});
