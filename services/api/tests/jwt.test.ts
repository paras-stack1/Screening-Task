import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { AuthConfig } from '../src/config/security';
import { signAccessToken, verifyAccessToken } from '../src/utils/jwt';
import { generateRefreshToken, hashRefreshToken } from '../src/utils/token';

const config: AuthConfig['jwt'] = {
  secret: new TextEncoder().encode('unit-test-only-jwt-secret-0123456789abcdef'),
  issuer: 'balswasthya-api:test',
  audience: 'balswasthya-worker-app',
  accessTokenTtlSeconds: 900,
};
const claims = { userId: randomUUID(), sessionId: randomUUID() };
const T0 = new Date('2026-11-21T10:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A token with full control over header and payload, HMAC-signed with `key`. */
async function custom(
  payload: Record<string, unknown>,
  header: { alg: string; typ?: string } = { alg: 'HS256', typ: 'at+jwt' },
  key: Uint8Array = config.secret,
) {
  const now = Math.floor(T0.getTime() / 1000);
  const body: Record<string, unknown> = {
    iss: config.issuer,
    aud: config.audience,
    sub: claims.userId,
    sid: claims.sessionId,
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 900,
    ...payload,
  };
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  return new SignJWT(body).setProtectedHeader(header).sign(key);
}

async function validToken() {
  return (await signAccessToken(config, claims, T0)).token;
}

describe('access tokens: valid', () => {
  it('round-trips user and session ids, expiring after the configured TTL', async () => {
    const signed = await signAccessToken(config, claims, T0);
    expect(signed.expiresAt.toISOString()).toBe(at(900).toISOString());
    expect(await verifyAccessToken(config, signed.token, at(1))).toEqual(claims);
  });

  it('contains only the documented claims - no personal or authorisation data', async () => {
    const [, payload] = (await validToken()).split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'jti', 'nbf', 'sid', 'sub']);
  });
});

describe('access tokens: rejected', () => {
  it('expired (beyond the 5 s clock tolerance)', async () => {
    expect(await verifyAccessToken(config, await validToken(), at(906))).toBeNull();
  });

  it('not yet valid (nbf in the future)', async () => {
    const token = await custom({ nbf: Math.floor(T0.getTime() / 1000) + 600 });
    expect(await verifyAccessToken(config, token, T0)).toBeNull();
  });

  it.each(['', 'garbage', 'a.b.c', 'eyJhbGciOiJIUzI1NiJ9.e30', `${'x'.repeat(50)}.${'y'.repeat(50)}.z`])(
    'malformed %j',
    async (token) => {
      expect(await verifyAccessToken(config, token, T0)).toBeNull();
    },
  );

  it('tampered payload (sub changed after signing)', async () => {
    const [header, , signature] = (await validToken()).split('.');
    const forged = b64({
      iss: config.issuer,
      aud: config.audience,
      sub: randomUUID(),
      sid: claims.sessionId,
      jti: 'x',
      iat: 0,
      nbf: 0,
      exp: 9_999_999_999,
    });
    expect(await verifyAccessToken(config, `${header}.${forged}.${signature}`, T0)).toBeNull();
  });

  it('signed with a different key', async () => {
    const otherKey = new TextEncoder().encode('another-secret-another-secret-another!!');
    expect(await verifyAccessToken(config, await custom({}, undefined, otherKey), T0)).toBeNull();
  });

  it('wrong issuer (e.g. another environment)', async () => {
    expect(
      await verifyAccessToken(config, await custom({ iss: 'balswasthya-api:production' }), T0),
    ).toBeNull();
  });

  it('wrong audience', async () => {
    expect(await verifyAccessToken(config, await custom({ aud: 'some-other-app' }), T0)).toBeNull();
  });

  it('alg "none" (unsigned token)', async () => {
    const payload = (await validToken()).split('.')[1]!;
    const unsigned = `${b64({ alg: 'none', typ: 'at+jwt' })}.${payload}.`;
    expect(await verifyAccessToken(config, unsigned, T0)).toBeNull();
  });

  it('a different HMAC algorithm (HS512) with the same key', async () => {
    expect(await verifyAccessToken(config, await custom({}, { alg: 'HS512', typ: 'at+jwt' }), T0)).toBeNull();
  });

  it('algorithm confusion: header claims RS256', async () => {
    const [, payload, signature] = (await validToken()).split('.');
    const confused = `${b64({ alg: 'RS256', typ: 'at+jwt' })}.${payload}.${signature}`;
    expect(await verifyAccessToken(config, confused, T0)).toBeNull();
  });

  it.each([{ typ: 'JWT' }, { typ: 'refresh+jwt' }, {}])('wrong token type %j', async (typ) => {
    expect(await verifyAccessToken(config, await custom({}, { alg: 'HS256', ...typ }), T0)).toBeNull();
  });

  it.each(['sub', 'sid', 'jti', 'exp', 'iat', 'nbf'])('missing required claim %s', async (claim) => {
    expect(await verifyAccessToken(config, await custom({ [claim]: undefined }), T0)).toBeNull();
  });

  it('subject that is not a user id', async () => {
    expect(await verifyAccessToken(config, await custom({ sub: 'admin' }), T0)).toBeNull();
  });

  it('a refresh token presented as an access token', async () => {
    expect(await verifyAccessToken(config, generateRefreshToken(), T0)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('are 256-bit random base64url strings, unique per call', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateRefreshToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('are stored as a SHA-256 hex digest that does not contain the token', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashRefreshToken(token)).toBe(hash);
  });
});
