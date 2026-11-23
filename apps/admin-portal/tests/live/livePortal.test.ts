import {
  areaListResponseSchema,
  assignmentListResponseSchema,
  assignmentResponseSchema,
  roleListResponseSchema,
  temporaryPasswordResponseSchema,
  userDetailResponseSchema,
  userListResponseSchema,
  userViewSchema,
} from '@balswasthya/shared-contracts';
import { z } from 'zod';
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

  it('stage PC: create a worker, find, view, suspend, reactivate, reset, sign out everywhere', async () => {
    const jar: Jar = { value: null, attributes: '' };
    const tab = createPortalServices({ apiBaseUrl: API!, fetchFn: browserLikeFetch(jar) });
    await tab.session.login(admin.login, admin.password);
    const api = tab.api;

    const roles = await api.get('/roles', roleListResponseSchema);
    const asha = roles.roles.find((r) => r.code === 'ASHA')!;
    const villages = await api.get(
      `/areas?search=${encodeURIComponent(process.env.LIVE_AREA_SEARCH ?? 'Area V1')}`,
      areaListResponseSchema,
    );
    const village = villages.items.find((a) => a.allowsChildRegistration)!;
    expect(village).toBeDefined();

    const loginId = `LIVE-PC-${Date.now().toString(36).toUpperCase()}`;
    const created = await api.post(
      '/users',
      {
        loginId,
        displayName: 'Synthetic Live Portal Worker',
        preferredLanguage: 'hi',
        assignment: { areaId: village.id, roleId: asha.id, scope: 'AREA_ONLY', reason: 'Live portal test' },
      },
      temporaryPasswordResponseSchema,
    );
    expect(created.user).toMatchObject({ loginId, mustChangePassword: true, status: 'ACTIVE' });

    const found = await api.get(`/users?search=${loginId}`, userListResponseSchema);
    expect(found.items.map((u) => u.loginId)).toEqual([loginId]);
    expect(found.items[0]!.currentAssignments[0]).toMatchObject({ roleCode: 'ASHA', status: 'ACTIVE' });

    const detail = await api.get(`/users/${created.user.id}`, userDetailResponseSchema);
    expect(detail.assignments).toHaveLength(1);

    // The new worker can sign in with the one-time password and must change it.
    const workerTab = createPortalServices({
      apiBaseUrl: API!,
      fetchFn: browserLikeFetch({ value: null, attributes: '' }),
    });
    await workerTab.session.login(loginId, created.temporaryPassword);
    const workerState = workerTab.session.getState();
    expect(workerState.status === 'authenticated' && workerState.user.mustChangePassword).toBe(true);

    const status = z.object({ user: userViewSchema });
    const suspended = await api.post(
      `/users/${created.user.id}/status`,
      { status: 'SUSPENDED', reason: 'Live test' },
      status,
    );
    expect(suspended.user.status).toBe('SUSPENDED');
    const active = await api.post(
      `/users/${created.user.id}/status`,
      { status: 'ACTIVE', reason: 'Live test' },
      status,
    );
    expect(active.user.status).toBe('ACTIVE');

    const reset = await api.post(
      `/users/${created.user.id}/reset-password`,
      { reason: 'Live test' },
      temporaryPasswordResponseSchema,
    );
    expect(reset.temporaryPassword).not.toBe(created.temporaryPassword);
    await api.post(`/users/${created.user.id}/revoke-sessions`, { reason: 'Live test' });

    // Leave nothing usable behind.
    const gone = await api.post(
      `/users/${created.user.id}/status`,
      { status: 'DEACTIVATED', reason: 'Live test clean-up' },
      status,
    );
    expect(gone.user.status).toBe('DEACTIVATED');
    await tab.session.logout();
  });

  it('stage PD: a supervisor finds a worker, adds an area, suspends, reactivates, ends and revokes', async () => {
    const supervisor = {
      login: process.env.LIVE_SUPERVISOR_LOGIN ?? '',
      password: process.env.LIVE_SUPERVISOR_PASSWORD ?? '',
    };
    const workerLogin = process.env.LIVE_ASSIGNEE_LOGIN ?? '';
    const tab = createPortalServices({
      apiBaseUrl: API!,
      fetchFn: browserLikeFetch({ value: null, attributes: '' }),
    });
    await tab.session.login(supervisor.login, supervisor.password);
    const api = tab.api;

    const listed = await api.get(`/assignments?search=${workerLogin}`, assignmentListResponseSchema);
    const person = listed.items[0]!.user;
    expect(person.loginId).toBe(workerLogin);

    const roles = await api.get('/roles', roleListResponseSchema);
    const asha = roles.roles.find((r) => r.code === 'ASHA')!;
    const areas = await api.get(
      `/areas?search=${encodeURIComponent(process.env.LIVE_ASSIGN_AREA_SEARCH ?? 'Area V1')}`,
      areaListResponseSchema,
    );
    const area = areas.items[0]!;

    const nextYear = new Date().getUTCFullYear() + 1;
    const created = await api.post(
      '/assignments',
      {
        userId: person.id,
        roleId: asha.id,
        areaId: area.id,
        scope: 'AREA_ONLY',
        effectiveTo: `${nextYear}-03-31T00:00:00.000+05:30`,
        reason: 'Live PD test',
      },
      assignmentResponseSchema,
    );
    const id = created.assignment.id;
    expect(created.assignment.status).toBe('ACTIVE');

    const act = (action: string, body: object) =>
      api.post(`/assignments/${id}/${action}`, body, assignmentResponseSchema);
    expect((await act('suspend', { reason: 'Live test' })).assignment.status).toBe('SUSPENDED');
    expect((await act('reactivate', { reason: 'Live test' })).assignment.status).toBe('ACTIVE');
    const ended = await act('end', {
      reason: 'Live test',
      effectiveTo: `${nextYear}-01-31T00:00:00.000+05:30`,
    });
    expect(ended.assignment.effectiveTo).toBe(new Date(`${nextYear}-01-31T00:00:00.000+05:30`).toISOString());
    // An assignment can only be shortened: extending is refused.
    await expect(
      act('end', { reason: 'Live test', effectiveTo: `${nextYear}-02-28T00:00:00.000+05:30` }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await act('revoke', { reason: 'Live test clean-up' })).assignment.status).toBe('REVOKED');
    await tab.session.logout();
  });
});
