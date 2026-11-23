import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortalServices, type PortalServices } from '../src/app/services';
import { canUsePortal } from '../src/auth/sessionManager';
import type { TabCoordination, TabMessage } from '../src/auth/tabCoordination';
import { ADMIN_ACCESS, BASE_URL, standardServer, WORKER_ACCESS, type FakeServer } from './support/fakeServer';

const okSchema = z.object({ ok: z.boolean() });

/** Records lock use and lets tests deliver messages "from another tab". */
function fakeTabs() {
  let listener: ((m: TabMessage) => void) | null = null;
  const announced: TabMessage[] = [];
  let exclusiveCalls = 0;
  const tabs: TabCoordination = {
    exclusive: (task) => {
      exclusiveCalls += 1;
      return task();
    },
    announce: (message) => announced.push(message),
    listen: (l) => {
      listener = l;
      return () => (listener = null);
    },
  };
  return {
    tabs,
    announced,
    exclusiveCalls: () => exclusiveCalls,
    fromOtherTab: (m: TabMessage) => listener?.(m),
  };
}

let server: FakeServer;
let tabs: ReturnType<typeof fakeTabs>;
let services: PortalServices;

beforeEach(() => {
  server = standardServer();
  tabs = fakeTabs();
  services = createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch, tabs: tabs.tabs });
});

const state = () => services.session.getState();
const login = (id = 'ADMIN-0001', pw = 'Synthetic-admin-2026') => services.session.login(id, pw);

describe('page load (continuing a session from the cookie)', () => {
  it('no cookie: signed out, without a "session ended" message', async () => {
    await services.session.initialize();
    expect(state()).toEqual({ status: 'unauthenticated' });
  });

  it('a valid cookie continues the session (a page refresh does not sign the admin out)', async () => {
    await login();
    const fresh = createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch, tabs: tabs.tabs });
    await fresh.session.initialize();
    const restored = fresh.session.getState();
    expect(restored.status).toBe('authenticated');
    if (restored.status === 'authenticated') {
      expect(restored.user.displayName).toBe('Synthetic State Admin');
      expect(restored.access).toEqual(ADMIN_ACCESS);
    }
  });

  it('server unreachable: restoreFailed, and retry succeeds later', async () => {
    await login();
    const fresh = createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch, tabs: tabs.tabs });
    server.failNext('/auth/web/refresh', 'network');
    await fresh.session.initialize();
    expect(fresh.session.getState().status).toBe('restoreFailed');
    await fresh.session.retryRestore();
    expect(fresh.session.getState().status).toBe('authenticated');
  });

  it('initialize is idempotent (React StrictMode runs effects twice)', async () => {
    await Promise.all([services.session.initialize(), services.session.initialize()]);
    expect(server.callsTo('/auth/web/refresh')).toHaveLength(1);
  });
});

describe('sign in and the cookie transport', () => {
  it('login uses the web endpoint with credentials and the portal header, then loads /auth/me', async () => {
    await login();
    expect(state().status).toBe('authenticated');
    const [loginCall] = server.callsTo('/auth/web/login');
    expect(loginCall).toMatchObject({ credentials: 'include', clientHeader: 'admin-portal' });
    expect(server.cookie).not.toBeNull();
    expect(tabs.announced).toEqual(['signedIn']);
  });

  it('only /auth/web/* calls send cookies; data calls never do', async () => {
    await login();
    await services.api.get('/test/protected', okSchema);
    expect(server.callsTo('/auth/me')[0]).toMatchObject({ credentials: 'omit', clientHeader: null });
    expect(server.callsTo('/test/protected')[0]).toMatchObject({ credentials: 'omit', clientHeader: null });
  });

  it('never writes tokens to localStorage or sessionStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await login();
    await services.session.refresh();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('a wrong password throws and stays signed out', async () => {
    await expect(login('ADMIN-0001', 'wrong-password')).rejects.toMatchObject({ status: 401 });
    expect(state().status).not.toBe('authenticated');
  });

  it('canUsePortal: administrators yes, field workers no', () => {
    expect(canUsePortal(ADMIN_ACCESS)).toBe(true);
    expect(canUsePortal({ ...ADMIN_ACCESS, permissions: ['assignment.manage'] })).toBe(true);
    expect(canUsePortal(WORKER_ACCESS)).toBe(false);
  });
});

describe('authorised calls and refresh', () => {
  it('on 401 it refreshes once (under the cross-tab lock) and retries once', async () => {
    await login();
    const before = tabs.exclusiveCalls();
    server.expireAccessTokens();
    await expect(services.api.get('/test/protected', okSchema)).resolves.toEqual({ ok: true });
    expect(server.callsTo('/auth/web/refresh')).toHaveLength(1);
    expect(tabs.exclusiveCalls()).toBe(before + 1);
    expect(server.callsTo('/test/protected')).toHaveLength(2);
  });

  it('concurrent 401s share ONE refresh (the cookie rotates on every use)', async () => {
    await login();
    server.expireAccessTokens();
    await Promise.all([
      services.api.get('/test/protected', okSchema),
      services.api.get('/test/protected', okSchema),
      services.api.get('/test/protected', okSchema),
    ]);
    expect(server.callsTo('/auth/web/refresh')).toHaveLength(1);
  });

  it('a session ended on the server signs the admin out with "session ended"', async () => {
    await login();
    server.revokeAllSessions();
    await expect(services.api.get('/test/protected', okSchema)).rejects.toMatchObject({ status: 401 });
    expect(state()).toEqual({ status: 'unauthenticated', reason: 'sessionEnded' });
  });

  it('refreshes before the access token expires instead of waiting for a 401', async () => {
    let now = Date.now();
    services = createPortalServices({
      apiBaseUrl: BASE_URL,
      fetchFn: server.fetch,
      tabs: tabs.tabs,
      now: () => now,
    });
    await login();
    await services.api.get('/test/protected', okSchema);
    expect(server.callsTo('/auth/web/refresh')).toHaveLength(0); // still fresh

    now += 14 * 60_000 + 1; // within the last minute of a 15-minute token
    await services.api.get('/test/protected', okSchema);
    expect(server.callsTo('/auth/web/refresh')).toHaveLength(1);
    expect(server.callsTo('/test/protected')).toHaveLength(2); // no wasted 401
  });

  it('a transient refresh failure keeps the session', async () => {
    await login();
    server.expireAccessTokens();
    server.failNext('/auth/web/refresh', 'network');
    await expect(services.api.get('/test/protected', okSchema)).rejects.toMatchObject({ kind: 'network' });
    expect(state().status).toBe('authenticated');
  });

  it('PASSWORD_CHANGE_REQUIRED from any call switches to the forced password change', async () => {
    await login();
    server.users.get('ADMIN-0001')!.mustChangePassword = true;
    await expect(services.api.get('/test/protected', okSchema)).rejects.toMatchObject({ status: 403 });
    const current = state();
    expect(current.status === 'authenticated' && current.user.mustChangePassword).toBe(true);
  });
});

describe('sign out, password change and other tabs', () => {
  it('logout ends the session here, tells other tabs and clears the cookie on the server', async () => {
    await login();
    const cleared = vi.fn();
    services.session.onSessionEnd(cleared);
    await services.session.logout();
    expect(state()).toEqual({ status: 'unauthenticated', reason: 'loggedOut' });
    expect(tabs.announced).toContain('signedOut');
    expect(server.cookie).toBeNull();
    expect(cleared).toHaveBeenCalledWith('loggedOut');
    // The old cookie value is dead on the server: a new page load stays signed out.
    const fresh = createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch });
    await fresh.session.initialize();
    expect(fresh.session.getState().status).toBe('unauthenticated');
  });

  it('logout works even when the server cannot be reached', async () => {
    await login();
    server.failNext('/auth/web/logout', 'network');
    await services.session.logout();
    expect(state()).toEqual({ status: 'unauthenticated', reason: 'loggedOut' });
  });

  it('a sign-out in another tab ends this tab too', async () => {
    await login();
    tabs.fromOtherTab('signedOut');
    expect(state()).toEqual({ status: 'unauthenticated', reason: 'loggedOut' });
  });

  it('a sign-in in another tab continues here from the shared cookie', async () => {
    await services.session.initialize();
    await createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: server.fetch }).session.login(
      'ADMIN-0001',
      'Synthetic-admin-2026',
    );
    tabs.fromOtherTab('signedIn');
    await vi.waitFor(() => expect(state().status).toBe('authenticated'));
  });

  it('a late login response after sign-out does not bring the session back', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/auth/web/login')) await gate;
      return server.fetch(input, init);
    };
    services = createPortalServices({ apiBaseUrl: BASE_URL, fetchFn: slowFetch, tabs: tabs.tabs });
    const pending = services.session.login('ADMIN-0001', 'Synthetic-admin-2026');
    await services.session.logout();
    release();
    await pending;
    expect(state().status).toBe('unauthenticated');
  });

  it('password change: new session from the server, old cookie dead, user no longer forced', async () => {
    await login('ADMIN-NEW', 'TEMP-ABCD-EFGH');
    const before = state();
    expect(before.status === 'authenticated' && before.user.mustChangePassword).toBe(true);
    const oldCookie = server.cookie;
    await services.session.changePassword({
      currentPassword: 'TEMP-ABCD-EFGH',
      newPassword: 'My own new password 1',
    });
    const after = state();
    expect(after.status === 'authenticated' && after.user.mustChangePassword).toBe(false);
    expect(server.cookie).not.toBe(oldCookie);
    await expect(services.api.get('/test/protected', okSchema)).resolves.toEqual({ ok: true });
  });
});
