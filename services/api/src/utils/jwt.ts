import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { AuthConfig } from '../config/security';

/**
 * Access tokens (decision C: 15 minutes by default).
 *
 * - HS256 only. Verification passes an explicit algorithm allowlist, so "alg": "none" and
 *   algorithm-confusion tokens (e.g. RS256 or HS512) are rejected.
 * - Header typ "at+jwt" (RFC 9068) separates access tokens from any other JWT signed with the
 *   same key.
 * - Claims: iss, aud, sub (user id), sid (session family id), jti, iat, nbf, exp. Nothing else:
 *   no names, roles, areas or health data. Roles and areas are read from the database on every
 *   request, so a token never carries stale permissions.
 * - A valid signature is not enough: `authenticate` also checks that the user is still ACTIVE
 *   and the session (sid) has not been revoked.
 */
export const ACCESS_TOKEN_TYPE = 'at+jwt';
const ALGORITHM = 'HS256';
/** Allowed clock difference between servers, in seconds. */
const CLOCK_TOLERANCE_SECONDS = 5;

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface SignedAccessToken {
  token: string;
  expiresAt: Date;
}

export async function signAccessToken(
  config: AuthConfig['jwt'],
  claims: AccessTokenClaims,
  now: Date = new Date(),
): Promise<SignedAccessToken> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAt + config.accessTokenTtlSeconds;
  const token = await new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: ALGORITHM, typ: ACCESS_TOKEN_TYPE })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(claims.userId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(config.secret);
  return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
}

const payloadSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  jti: z.string().min(1),
});

/**
 * Verifies signature, algorithm, typ, issuer, audience, exp, nbf and required claims.
 * Returns null for ANY failure - callers respond with the same generic 401 whatever the reason.
 */
export async function verifyAccessToken(
  config: AuthConfig['jwt'],
  token: string,
  now: Date = new Date(),
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, config.secret, {
      algorithms: [ALGORITHM],
      typ: ACCESS_TOKEN_TYPE,
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ['sub', 'sid', 'jti', 'iat', 'nbf', 'exp'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: now,
    });
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return { userId: parsed.data.sub, sessionId: parsed.data.sid };
  } catch {
    return null;
  }
}
