import {
  accessTokenLifetimeMs,
  FALLBACK_ACCESS_LIFETIME_MS,
} from '../../src/features/auth/services/accessTokenLifetime';
import { storageKeys, type KeyValueStore } from '../../src/services/storage/secureStorage';
import { createTestContext, seedSavedSession, WORKER, type TestContext } from '../support/testServices';

let context: TestContext;
const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  context = createTestContext();
  // Any console output from app code is a potential token leak (the app has no logging at all).
  for (const method of ['log', 'info', 'warn', 'debug'] as const) {
    consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  for (const spy of consoleSpies.splice(0)) expect(spy).not.toHaveBeenCalled();
});

const session = () => context.services.session;
const savedToken = () => context.store.getItem(storageKeys.refreshToken);

async function signIn() {
  context.backend.user(WORKER);
  await session().initialize();
  await session().login(WORKER.loginId, WORKER.password);
}

describe('start-up / session restoration', () => {
  it('without a saved session ends unauthenticated, with no network call', async () => {
    await session().initialize();
    expect(session().getState()).toEqual({ status: 'unauthenticated' });
    expect(context.backend.fetchFn).not.toHaveBeenCalled();
  });

  it('restores a saved session and saves the rotated refresh token', async () => {
    const original = await seedSavedSession(context);
    await session().initialize();
    expect(session().getState()).toMatchObject({
      status: 'authenticated',
      user: { displayName: WORKER.displayName },
    });
    const stored = await savedToken();
    expect(stored).not.toBe(original.refreshToken);
    expect(context.backend.isRefreshTokenUsable(stored!)).toBe(true);
  });

  it('initialize() is idempotent: one refresh however often it is called', async () => {
    await seedSavedSession(context);
    await Promise.all([session().initialize(), session().initialize(), session().initialize()]);
    expect(context.backend.callsTo('/auth/refresh')).toHaveLength(1);
  });

  it('an expired / revoked saved session is deleted and reported as ended', async () => {
    const original = await seedSavedSession(context);
    await context.services.authApi.logout(original.refreshToken); // revoked server-side
    await session().initialize();
    expect(session().getState()).toEqual({ status: 'unauthenticated', reason: 'sessionEnded' });
    expect(await savedToken()).toBeNull();
  });

  it('a deactivated account cannot restore its session', async () => {
    await seedSavedSession(context);
    context.backend.deactivate(WORKER.loginId);
    await session().initialize();
    expect(session().getState()).toEqual({ status: 'unauthenticated', reason: 'sessionEnded' });
    expect(await savedToken()).toBeNull();
  });

  it('offline at start-up keeps the saved session and offers a retry (decision M)', async () => {
    const original = await seedSavedSession(context);
    context.backend.setOffline(true);
    await session().initialize();
    expect(session().getState()).toEqual({ status: 'restoreFailed' });
    expect(await savedToken()).toBe(original.refreshToken);

    context.backend.setOffline(false);
    await session().retryRestore();
    expect(session().getState()).toMatchObject({ status: 'authenticated' });
  });

  it.each([429, 500, 503])('a %i during restore is treated as temporary', async (status) => {
    await seedSavedSession(context);
    context.backend.override('/auth/refresh', { status });
    await session().initialize();
    expect(session().getState()).toEqual({ status: 'restoreFailed' });
    expect(await savedToken()).not.toBeNull();
  });

  it('unreadable secure storage starts signed out instead of crashing', async () => {
    const broken: KeyValueStore = {
      getItem: () => Promise.reject(new Error('keystore')),
      setItem: () => Promise.resolve(),
      deleteItem: () => Promise.resolve(),
    };
    context = createTestContext({ store: broken });
    await session().initialize();
    expect(session().getState()).toEqual({ status: 'unauthenticated' });
  });

  it('signing out from the restore-failed screen clears the saved session', async () => {
    const original = await seedSavedSession(context);
    context.backend.setOffline(true);
    await session().initialize();
    await session().logout();
    expect(session().getState()).toEqual({ status: 'unauthenticated', reason: 'loggedOut' });
    expect(await savedToken()).toBeNull();
    context.backend.setOffline(false);
    // Best-effort server revocation failed offline; the token was still removed locally.
    expect(context.backend.isRefreshTokenUsable(original.refreshToken)).toBe(true);
  });
});

describe('login', () => {
  it('stores only the refresh token, never the password or access token', async () => {
    const stored: string[] = [];
    const base = context.store;
    const recordingStore: KeyValueStore = {
      ...base,
      setItem: async (key, value) => {
        stored.push(`${key}=${value}`);
        await base.setItem(key, value);
      },
    };
    context = createTestContext({ backend: context.backend, store: recordingStore });
    await signIn();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^bs\.auth\.refreshToken=refresh-/);
    expect(stored.join()).not.toContain(WORKER.password);
  });

  it('sends a generic device label (decision L)', async () => {
    await signIn();
    expect(context.backend.callsTo('/auth/login')[0]!.body).toMatchObject({
      deviceLabel: expect.stringMatching(/phone|iPhone|browser/),
    });
  });

  it('wrong credentials leave the app signed out with nothing stored', async () => {
    context.backend.user(WORKER);
    await session().initialize();
    await expect(session().login(WORKER.loginId, 'wrong password')).rejects.toMatchObject({ status: 401 });
    expect(session().getState()).toEqual({ status: 'unauthenticated' });
    expect(await savedToken()).toBeNull();
  });

  it('still signs in when the token cannot be saved (works until restart)', async () => {
    const failingWrites: KeyValueStore = {
      ...context.store,
      setItem: () => Promise.reject(new Error('full')),
    };
    context = createTestContext({ backend: context.backend, store: failingWrites });
    await signIn();
    expect(session().getState()).toMatchObject({ status: 'authenticated' });
  });
});

describe('access tokens and refresh', () => {
  it('reuses a valid access token without refreshing', async () => {
    await signIn();
    const first = await session().getAccessToken();
    expect(await session().getAccessToken()).toBe(first);
    expect(context.backend.callsTo('/auth/refresh')).toHaveLength(0);
  });

  it('refreshes shortly before expiry, measured from the token lifetime not the server clock', async () => {
    await signIn();
    const first = await session().getAccessToken();
    context.clock.now += 14 * 60_000 + 1; // within the 60 s margin of a 15 min token
    const second = await session().getAccessToken();
    expect(second).not.toBe(first);
    expect(context.backend.callsTo('/auth/refresh')).toHaveLength(1);
  });

  it('concurrent callers share ONE refresh (single-flight)', async () => {
    await signIn();
    context.clock.now += 20 * 60_000;
    const tokens = await Promise.all(Array.from({ length: 8 }, () => session().getAccessToken()));
    expect(new Set(tokens).size).toBe(1);
    expect(context.backend.callsTo('/auth/refresh')).toHaveLength(1);
    // The family was not revoked for reuse: the saved token is still the live one.
    expect(context.backend.isRefreshTokenUsable((await savedToken())!)).toBe(true);
  });

  it('a temporary refresh failure keeps the session', async () => {
    await signIn();
    context.clock.now += 20 * 60_000;
    context.backend.override('/auth/refresh', 'network');
    await expect(session().getAccessToken()).rejects.toMatchObject({ kind: 'network' });
    expect(session().getState()).toMatchObject({ status: 'authenticated' });
    await expect(session().getAccessToken()).resolves.toEqual(expect.any(String));
  });

  it('a rejected refresh ends the session, deletes the token and notifies listeners', async () => {
    await signIn();
    const ended = jest.fn();
    session().onSessionEnd(ended);
    context.clock.now += 20 * 60_000;
    context.backend.override('/auth/refresh', {
      status: 401,
      body: { error: { code: 'SESSION_EXPIRED', message: 'x' } },
    });
    await expect(session().getAccessToken()).rejects.toMatchObject({ status: 401 });
    expect(session().getState()).toEqual({ status: 'unauthenticated', reason: 'sessionEnded' });
    expect(ended).toHaveBeenCalledWith('sessionEnded');
    expect(await savedToken()).toBeNull();
  });

  it('no access token is available without a session', async () => {
    await session().initialize();
    await expect(session().getAccessToken()).rejects.toMatchObject({ kind: 'noSession' });
  });
});

describe('logout (decision P)', () => {
  it('clears local credentials and revokes the session on the server', async () => {
    await signIn();
    const token = (await savedToken())!;
    await session().logout();
    expect(session().getState()).toEqual({ status: 'unauthenticated', reason: 'loggedOut' });
    expect(await savedToken()).toBeNull();
    expect(context.backend.isRefreshTokenUsable(token)).toBe(false);
    await expect(session().getAccessToken()).rejects.toMatchObject({ kind: 'noSession' });
  });

  it('works offline (local clearing does not depend on the server)', async () => {
    await signIn();
    context.backend.setOffline(true);
    await session().logout();
    expect(session().getState()).toEqual({ status: 'unauthenticated', reason: 'loggedOut' });
    expect(await savedToken()).toBeNull();
  });

  it('a refresh that completes after logout cannot resurrect the session', async () => {
    await signIn();
    context.clock.now += 20 * 60_000;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realFetch = context.backend.fetchFn.getMockImplementation()!;
    // The server rotates the token immediately, but its response reaches the app only later.
    context.backend.fetchFn.mockImplementationOnce(async (...args) => {
      const result = await realFetch(...args);
      await gate;
      return result;
    });

    const pending = session().getAccessToken();
    await session().logout();
    release();
    await expect(pending).rejects.toMatchObject({ kind: 'noSession' });

    expect(session().getState()).toEqual({ status: 'unauthenticated', reason: 'loggedOut' });
    expect(await savedToken()).toBeNull();
    // The token issued by the late refresh was revoked rather than kept.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const issued = context.backend
      .callsTo('/auth/logout')
      .map((call) => (call.body as { refreshToken: string }).refreshToken);
    expect(issued.length).toBeGreaterThanOrEqual(2);
    for (const token of issued) expect(context.backend.isRefreshTokenUsable(token)).toBe(false);
  });
});

describe('password change (decision O)', () => {
  it('replaces the tokens and clears mustChangePassword', async () => {
    context.backend.user({ ...WORKER, mustChangePassword: true });
    await session().initialize();
    await session().login(WORKER.loginId, WORKER.password);
    expect(session().getState()).toMatchObject({ user: { mustChangePassword: true } });
    const before = (await savedToken())!;

    await session().changePassword({ currentPassword: WORKER.password, newPassword: 'naya surakshit vakya' });
    expect(session().getState()).toMatchObject({
      status: 'authenticated',
      user: { mustChangePassword: false },
    });
    const after = (await savedToken())!;
    expect(after).not.toBe(before);
    expect(context.backend.isRefreshTokenUsable(after)).toBe(true);
    expect(context.backend.isRefreshTokenUsable(before)).toBe(false);
  });

  it('a wrong current password keeps the session and reports the error', async () => {
    await signIn();
    await expect(
      session().changePassword({ currentPassword: 'wrong', newPassword: 'naya surakshit vakya' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
    expect(session().getState()).toMatchObject({ status: 'authenticated' });
  });
});

describe('accessTokenLifetimeMs', () => {
  const token = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

  it('reads exp - iat', () => {
    expect(accessTokenLifetimeMs(token({ iat: 100, exp: 1000 }))).toBe(900_000);
  });

  it.each([
    ['garbage'],
    ['a.b.c'],
    [token({ iat: 100 })],
    [token({ iat: 100, exp: 50 })],
    [token({ iat: 0, exp: 10 ** 9 })],
  ])('falls back for an unusable token %#', (value) => {
    expect(accessTokenLifetimeMs(value)).toBe(FALLBACK_ACCESS_LIFETIME_MS);
  });
});
