import { describe, expect, it } from 'vitest';
import { createHttp } from '../src/api/http';
import { contentSecurityPolicy } from '../src/security/contentSecurityPolicy';
import { accessTokenLifetimeMs, FALLBACK_ACCESS_LIFETIME_MS } from '../src/auth/tokenLifetime';
import { parseApiBaseUrl } from '../src/config';
import { en } from '../src/i18n/en';
import { hi } from '../src/i18n/hi';
import { errorMessageKey } from '../src/i18n';
import { ApiError } from '../src/api/errors';

describe('API address configuration', () => {
  it.each([
    ['http://localhost:4000/api/v1', false, 'http://localhost:4000/api/v1'],
    ['http://192.168.1.23:4000/api/v1/', false, 'http://192.168.1.23:4000/api/v1'],
    ['https://api.example.gov.in/api/v1', true, 'https://api.example.gov.in/api/v1'],
    [undefined, false, 'http://localhost:4000/api/v1'],
    [undefined, true, null],
    ['http://api.example.gov.in/api/v1', true, null], // production must use https
    ['https://api.example.gov.in', true, null], // must end in /api/v1
    ['https://user:pw@api.example.gov.in/api/v1', true, null],
    ['https://api.example.gov.in/api/v1?x=1', true, null],
    ['not a url', false, null],
  ] as const)('%s (production %s) -> %s', (raw, production, expected) => {
    expect(parseApiBaseUrl(raw, production)).toBe(expected);
  });
});

describe('HTTP client', () => {
  function capture() {
    const seen: RequestInit[] = [];
    const fetchFn: typeof fetch = async (_input, init) => {
      seen.push(init ?? {});
      return new Response(JSON.stringify({ error: { code: 'X', message: 'm', requestId: 'r-1' } }), {
        status: 409,
      });
    };
    return { seen, request: createHttp({ baseUrl: 'http://api.test/api/v1', fetchFn }) };
  }

  it('sends cookies and the portal header only when asked, and never caches', async () => {
    const { seen, request } = capture();
    await request({ method: 'POST', path: '/auth/web/refresh', withSessionCookie: true }).catch(
      () => undefined,
    );
    await request({ method: 'GET', path: '/users', accessToken: 't' }).catch(() => undefined);
    expect(seen[0]).toMatchObject({ credentials: 'include', cache: 'no-store' });
    expect(new Headers(seen[0]!.headers).get('x-balswasthya-client')).toBe('admin-portal');
    expect(seen[1]).toMatchObject({ credentials: 'omit' });
    expect(new Headers(seen[1]!.headers).get('x-balswasthya-client')).toBeNull();
    expect(new Headers(seen[1]!.headers).get('authorization')).toBe('Bearer t');
  });

  it('turns an error envelope into an ApiError with code and request id (no server message)', async () => {
    const { request } = capture();
    const error = await request({ method: 'GET', path: '/x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status: 409, code: 'X', requestId: 'r-1' });
    expect((error as Error).message).not.toContain('m"');
  });

  it('without a configured address no request is made', async () => {
    let called = false;
    const request = createHttp({
      baseUrl: null,
      fetchFn: async () => {
        called = true;
        return new Response();
      },
    });
    await expect(request({ method: 'GET', path: '/x' })).rejects.toMatchObject({ kind: 'notConfigured' });
    expect(called).toBe(false);
  });
});

describe('access token lifetime', () => {
  const token = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
  it('uses exp - iat, independent of the computer clock', () => {
    expect(accessTokenLifetimeMs(token({ iat: 1000, exp: 1900 }))).toBe(900_000);
  });
  it('falls back to a short lifetime for unreadable tokens', () => {
    expect(accessTokenLifetimeMs('garbage')).toBe(FALLBACK_ACCESS_LIFETIME_MS);
    expect(accessTokenLifetimeMs(token({ iat: 1000 }))).toBe(FALLBACK_ACCESS_LIFETIME_MS);
  });
});

describe('translations', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  it.each(Object.keys(en))('%s: Hindi present, not empty, same placeholders', (key) => {
    const k = key as keyof typeof en;
    expect(hi[k].trim().length).toBeGreaterThan(0);
    expect(placeholders(hi[k])).toEqual(placeholders(en[k]));
  });

  it('maps errors to safe messages', () => {
    expect(errorMessageKey(new ApiError('network'))).toBe('errors.network');
    expect(errorMessageKey(new ApiError('http', { status: 429 }))).toBe('errors.tooManyRequests');
    expect(errorMessageKey(new ApiError('http', { status: 403 }))).toBe('errors.forbidden');
    expect(errorMessageKey(new ApiError('http', { status: 503 }))).toBe('errors.server');
    expect(errorMessageKey(new Error('boom'))).toBe('errors.unexpected');
  });
});

describe('Content-Security-Policy of the built page (security review PE-1)', () => {
  it('allows only the page itself and the configured API; no inline script, no plugins, no base or form targets', () => {
    const policy = contentSecurityPolicy('https://api.example.gov.in/api/v1');
    const directives = Object.fromEntries(
      policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]),
    );
    expect(directives).toEqual({
      'default-src': "'none'",
      'script-src': "'self'",
      'style-src': "'self'",
      'img-src': "'self' data:",
      'font-src': "'self'",
      'connect-src': 'https://api.example.gov.in',
      'manifest-src': "'self'",
      'base-uri': "'none'",
      'form-action': "'none'",
      'object-src': "'none'",
    });
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it('without a valid API address the page may connect nowhere', () => {
    expect(contentSecurityPolicy(null)).toContain("connect-src 'none'");
  });
});
