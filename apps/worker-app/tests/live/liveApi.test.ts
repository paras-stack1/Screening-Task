/**
 * OPT-IN contract check against a RUNNING API (never part of `npm test` by default).
 * Uses the real app modules (HTTP layer, SessionManager, API client) with real network calls.
 *
 *   $env:LIVE_API_URL="http://localhost:4000/api/v1"
 *   $env:LIVE_LOGIN_ID="ADMIN-0001"
 *   $env:LIVE_PASSWORD="<temporary password>"
 *   $env:LIVE_NEW_PASSWORD="<new password, 8+ characters>"
 *   npx jest tests/live
 *
 * Expects a fresh account with mustChangePassword = true (e.g. from db:bootstrap-admin).
 * The account's password is changed to LIVE_NEW_PASSWORD. Credentials come only from the
 * environment and are never printed.
 */
import { childListResponseSchema } from '@balswasthya/shared-contracts';
import http from 'http';
import https from 'https';
import { createAppServices } from '../../src/services/appServices';
import { isApiError } from '../../src/services/api/errors';
import { createMemoryStore, storageKeys } from '../../src/services/storage/secureStorage';

const { LIVE_API_URL, LIVE_LOGIN_ID, LIVE_PASSWORD, LIVE_NEW_PASSWORD } = process.env;
const enabled = Boolean(LIVE_API_URL && LIVE_LOGIN_ID && LIVE_PASSWORD && LIVE_NEW_PASSWORD);

/**
 * React Native's Jest setup replaces global fetch with a polyfill that cannot reach a server, so this
 * file talks to the API through Node's http module. Only the subset used by src/services/api/http.ts
 * is implemented (status, ok, headers.get, text, abort).
 */
const nodeFetch = ((input: string, init: RequestInit = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(input);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      { method: init.method ?? 'GET', headers: init.headers as Record<string, string> },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (name: string) => (response.headers[name.toLowerCase()] as string) ?? null },
            text: async () => body,
          });
        });
      },
    );
    request.on('error', reject);
    init.signal?.addEventListener('abort', () => request.destroy(new Error('aborted')));
    if (init.body) request.write(init.body);
    request.end();
  })) as unknown as typeof fetch;

(enabled ? describe : describe.skip)('live API contract (Step 3 backend)', () => {
  jest.setTimeout(60_000);
  const store = createMemoryStore();
  const make = () =>
    createAppServices({
      config: { api: { ok: true, url: LIVE_API_URL! }, requestTimeoutMs: 20_000 },
      store,
      fetchFn: nodeFetch,
    });
  let services = make();

  it('rejects wrong credentials with the generic 401', async () => {
    await services.session.initialize();
    const error = await services.session.login(LIVE_LOGIN_ID!, 'definitely wrong').catch((e: unknown) => e);
    expect(isApiError(error) && error.status === 401 && error.code === 'INVALID_CREDENTIALS').toBe(true);
    expect(services.session.getState()).toEqual({ status: 'unauthenticated' });
  });

  it('signs in with the temporary password and requires a password change', async () => {
    await services.session.login(LIVE_LOGIN_ID!, LIVE_PASSWORD!);
    expect(services.session.getState()).toMatchObject({
      status: 'authenticated',
      user: { mustChangePassword: true },
    });
    expect(await store.getItem(storageKeys.refreshToken)).toEqual(expect.any(String));
  });

  it('other routes answer 403 PASSWORD_CHANGE_REQUIRED until the password is changed', async () => {
    const error = await services.api
      .get('/children?pageSize=1', childListResponseSchema)
      .catch((e: unknown) => e);
    expect(isApiError(error) && error.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED').toBe(true);
    expect(services.session.getState()).toMatchObject({ user: { mustChangePassword: true } });
  });

  it('reports a password-policy rule from the server', async () => {
    const error = await services.session
      .changePassword({ currentPassword: LIVE_PASSWORD!, newPassword: 'short' })
      .catch((e: unknown) => e);
    expect(isApiError(error) && error.code === 'PASSWORD_POLICY').toBe(true);
    expect(isApiError(error) && (error.details as { rule?: string }).rule).toBe('TOO_SHORT');
  });

  it('changes the password and receives new tokens', async () => {
    const before = await store.getItem(storageKeys.refreshToken);
    await services.session.changePassword({
      currentPassword: LIVE_PASSWORD!,
      newPassword: LIVE_NEW_PASSWORD!,
    });
    expect(services.session.getState()).toMatchObject({ user: { mustChangePassword: false } });
    expect(await store.getItem(storageKeys.refreshToken)).not.toBe(before);
  });

  it('GET /auth/me matches the shared contract', async () => {
    const me = await services.session.authorized((token) => services.authApi.me(token));
    expect(me.user.mustChangePassword).toBe(false);
    expect(Array.isArray(me.access.permissions)).toBe(true);
    expect(me.access.assignments.length).toBeGreaterThan(0);
  });

  it('a route the role may not use answers 403 without ending the session', async () => {
    const me = await services.session.authorized((token) => services.authApi.me(token));
    const result = await services.api
      .get('/children?pageSize=1', childListResponseSchema)
      .then((list) => ({ ok: true as const, list }))
      .catch((e: unknown) => ({ ok: false as const, e }));
    if (me.access.permissions.includes('child.read')) {
      expect(result.ok).toBe(true);
    } else {
      expect(!result.ok && isApiError(result.e) && result.e.status === 403).toBe(true);
    }
    expect(services.session.getState().status).toBe('authenticated');
  });

  it('concurrent refreshes share one rotation and the session stays valid', async () => {
    const tokens = await Promise.all([
      services.session.refresh(),
      services.session.refresh(),
      services.session.refresh(),
    ]);
    expect(new Set(tokens).size).toBe(1);
    await expect(services.session.authorized((token) => services.authApi.me(token))).resolves.toBeDefined();
  });

  it('restores the session after an app restart from the saved refresh token', async () => {
    services = make(); // new SessionManager, same device store
    await services.session.initialize();
    expect(services.session.getState()).toMatchObject({ status: 'authenticated' });
  });

  it('logout revokes the session on the server', async () => {
    // Keep a copy of the token to prove the server no longer accepts it.
    const token = (await store.getItem(storageKeys.refreshToken))!;
    await services.session.logout();
    expect(await store.getItem(storageKeys.refreshToken)).toBeNull();
    const error = await services.authApi.refresh(token).catch((e: unknown) => e);
    expect(isApiError(error) && error.status === 401).toBe(true);
  });
});
