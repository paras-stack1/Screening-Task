import { describe, expect, it } from 'vitest';
import { createPortalServices } from '../../src/app/services';
import { canUsePortal } from '../../src/auth/sessionManager';

/**
 * OPT-IN live run of the portal's real session code against a running API (stage PB).
 * Skipped unless LIVE_API_URL is set, e.g.
 *
 *   $env:LIVE_API_URL="http://localhost:4100/api/v1"; $env:LIVE_ORIGIN="http://localhost:5173"
 *   $env:LIVE_ADMIN_LOGIN="..."; $env:LIVE_ADMIN_PASSWORD="..."; $env:LIVE_WORKER_LOGIN="..."
 *   $env:LIVE_WORKER_PASSWORD="..."; npx vitest run tests/live
 *
 * Use synthetic accounts on a development or test database only. Node's fetch has no cookie
 * jar, so `browserLikeFetch` plays the browser: it sends the Origin header and keeps the
 * refresh cookie for /api/v1/auth/web exactly as the cookie attributes say.
 */
const API = process.env.LIVE_API_URL;
const ORIGIN = process.env.LIVE_ORIGIN ?? 'http://localhost:5173';

interface Jar {
  value: string | null;
  attributes: string;
}

function browserLikeFetch(jar: Jar): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init.headers);
    headers.set('Origin', ORIGIN);
    const cookieAllowed = init.credentials === 'include' && url.pathname.startsWith('/api/v1/auth/web');
    if (cookieAllowed && jar.value) headers.set('Cookie', `bs_admin_rt=${jar.value}`);
    const response = await fetch(url, { ...init, headers });
    if (init.credentials === 'include') {
      for (const raw of response.headers.getSetCookie()) {
        if (!raw.startsWith('bs_admin_rt=')) continue;
        const value = raw.slice('bs_admin_rt='.length).split(';')[0] ?? '';
        jar.value = value === '' ? null : value;
        jar.attributes = raw.slice(raw.indexOf(';'));
      }
    }
    return response;
  };
}

describe.skipIf(!API)('live: admin portal session against a running API', () => {
  const admin = {
    login: process.env.LIVE_ADMIN_LOGIN ?? '',
    password: process.env.LIVE_ADMIN_PASSWORD ?? '',
  };
  const worker = {
    login: process.env.LIVE_WORKER_LOGIN ?? '',
    password: process.env.LIVE_WORKER_PASSWORD ?? '',
  };

  it('administrator: sign in, cookie attributes, page reload continues, refresh rotates, sign out', async () => {
    const jar: Jar = { value: null, attributes: '' };
    const tab = createPortalServices({ apiBaseUrl: API!, fetchFn: browserLikeFetch(jar) });
    await tab.session.initialize();
    expect(tab.session.getState()).toEqual({ status: 'unauthenticated' });

    await tab.session.login(admin.login, admin.password);
    const state = tab.session.getState();
    expect(state.status).toBe('authenticated');
    if (state.status === 'authenticated') expect(canUsePortal(state.access)).toBe(true);
    expect(jar.value).not.toBeNull();
    expect(jar.attributes).toMatch(/HttpOnly/i);
    expect(jar.attributes).toMatch(/SameSite=Strict/i);
    expect(jar.attributes).toMatch(/Path=\/api\/v1\/auth\/web/i);

    // A "page reload": new services, same cookie jar.
    const reloaded = createPortalServices({ apiBaseUrl: API!, fetchFn: browserLikeFetch(jar) });
    const before = jar.value;
    await reloaded.session.initialize();
    expect(reloaded.session.getState().status).toBe('authenticated');
    expect(jar.value).not.toBe(before); // rotated

    // The area tree endpoint answers with the access token from the cookie session.
    const areas = await reloaded.api.get(
      '/areas',
      (await import('@balswasthya/shared-contracts')).areaListResponseSchema,
    );
    expect(areas.items.length).toBeGreaterThan(0);

    await reloaded.session.logout();
    expect(jar.value).toBeNull();
    const afterLogout = createPortalServices({ apiBaseUrl: API!, fetchFn: browserLikeFetch(jar) });
    await afterLogout.session.initialize();
    expect(afterLogout.session.getState().status).toBe('unauthenticated');
  });

  it('field worker: can sign in but is not allowed into the portal', async () => {
    const jar: Jar = { value: null, attributes: '' };
    const tab = createPortalServices({ apiBaseUrl: API!, fetchFn: browserLikeFetch(jar) });
    await tab.session.login(worker.login, worker.password);
    const state = tab.session.getState();
    expect(state.status === 'authenticated' && canUsePortal(state.access)).toBe(false);
    await tab.session.logout();
  });

  it('wrong password: refused with the generic 401', async () => {
    const tab = createPortalServices({
      apiBaseUrl: API!,
      fetchFn: browserLikeFetch({ value: null, attributes: '' }),
    });
    await expect(tab.session.login(admin.login, 'definitely-wrong-1')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });
});
