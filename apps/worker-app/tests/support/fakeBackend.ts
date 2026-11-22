/**
 * In-memory stand-in for the Step 3 auth API (docs/authentication.md), used ONLY in tests.
 * It mimics the behaviours the app depends on: rotation, reuse detection (family revoked),
 * logout, the mustChangePassword gate, generic 401s and the error envelope.
 */
import { createFakeChildren } from './fakeChildren';

export const TEST_BASE_URL = 'https://api.test/api/v1';

interface FakeUser {
  id: string;
  loginId: string;
  password: string;
  displayName: string;
  preferredLanguage: string;
  mustChangePassword: boolean;
  active: boolean;
  /** Effective access returned by GET /auth/me (synthetic). */
  permissions: string[];
  assignments: FakeAssignment[];
}

export interface FakeAssignment {
  assignmentId: string;
  roleCode: string;
  scope: 'AREA_ONLY' | 'AREA_AND_DESCENDANTS';
  areaId: string;
  areaName: string;
  areaNameHi: string | null;
  areaLevel: string;
  effectiveTo: string | null;
}

/** Synthetic ASHA assignment in a synthetic village. */
export const ASHA_ASSIGNMENT: FakeAssignment = {
  assignmentId: 'assignment-1',
  roleCode: 'ASHA',
  scope: 'AREA_ONLY',
  areaId: 'area-village-1',
  areaName: 'Rampur (synthetic)',
  areaNameHi: 'रामपुर (कृत्रिम)',
  areaLevel: 'VILLAGE',
  effectiveTo: null,
};

interface RefreshRow {
  userId: string;
  family: number;
  current: boolean;
  revoked: boolean;
}

export interface RecordedCall {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Override = { status: number; body?: unknown } | 'network' | 'hang';

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createFakeBackend() {
  let counter = 0;
  let familyCounter = 0;
  const users = new Map<string, FakeUser>();
  const refreshRows = new Map<string, RefreshRow>();
  const accessTokens = new Map<string, { userId: string; family: number }>();
  const calls: RecordedCall[] = [];
  const overrides = new Map<string, Override[]>();
  let offline = false;
  /** Seconds of access-token lifetime written into the JWT-shaped tokens. */
  let accessLifetimeSeconds = 900;
  /** `total` returned by GET /children for any caller with child.read. */
  let childrenTotal = 0;
  /** Step 5 children / guardians API (tests/support/fakeChildren.ts). */
  const childStore = createFakeChildren();

  const user = (input: Partial<FakeUser> & { loginId: string; password: string }): FakeUser => {
    const created: FakeUser = {
      id: `user-${users.size + 1}`,
      displayName: 'Synthetic Worker',
      preferredLanguage: 'hi',
      mustChangePassword: false,
      active: true,
      permissions: ['child.read', 'child.create', 'screening.conduct'],
      assignments: [ASHA_ASSIGNMENT],
      ...input,
    };
    users.set(created.loginId.toUpperCase(), created);
    return created;
  };

  function issue(target: FakeUser, family = ++familyCounter) {
    counter += 1;
    const iat = 1_700_000_000 + counter;
    const accessToken = `${encode({ alg: 'HS256', typ: 'at+jwt' })}.${encode({
      sub: target.id,
      iat,
      exp: iat + accessLifetimeSeconds,
      n: counter,
    })}.signature${counter}`;
    const refreshToken = `refresh-${counter}-${'x'.repeat(30)}`;
    accessTokens.set(accessToken, { userId: target.id, family });
    refreshRows.set(refreshToken, { userId: target.id, family, current: true, revoked: false });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + accessLifetimeSeconds * 1000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      user: {
        id: target.id,
        displayName: target.displayName,
        preferredLanguage: target.preferredLanguage,
        mustChangePassword: target.mustChangePassword,
      },
    };
  }

  const byId = (id: string) => [...users.values()].find((candidate) => candidate.id === id);

  function revokeFamily(family: number) {
    for (const row of refreshRows.values()) if (row.family === family) row.revoked = true;
    for (const [token, info] of accessTokens) if (info.family === family) accessTokens.delete(token);
  }

  const json = (status: number, body?: unknown) => ({ status, body });
  const error = (status: number, code: string, details?: unknown) =>
    json(status, { error: { code, message: `generic ${code}`, requestId: 'req-test', details } });

  function authenticate(headers: Record<string, string>, path: string) {
    const token = headers.Authorization?.replace(/^Bearer /, '');
    const info = token ? accessTokens.get(token) : undefined;
    const owner = info ? byId(info.userId) : undefined;
    if (!info || !owner || !owner.active) return { fail: error(401, 'UNAUTHENTICATED') };
    const allowed = ['/auth/me', '/auth/change-password', '/auth/logout-all'];
    if (owner.mustChangePassword && !allowed.includes(path))
      return { fail: error(403, 'PASSWORD_CHANGE_REQUIRED') };
    return { owner, family: info.family };
  }

  function route(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ) {
    if (method === 'POST' && path === '/auth/login') {
      const found = users.get(String(body.loginId).toUpperCase());
      if (!found || found.password !== body.password || !found.active)
        return error(401, 'INVALID_CREDENTIALS');
      return json(200, issue(found));
    }
    if (method === 'POST' && path === '/auth/refresh') {
      const row = refreshRows.get(String(body.refreshToken));
      if (!row) return error(401, 'SESSION_EXPIRED');
      if (row.revoked || !row.current) {
        revokeFamily(row.family); // reuse detection
        return error(401, 'SESSION_EXPIRED');
      }
      const owner = byId(row.userId);
      if (!owner || !owner.active) {
        revokeFamily(row.family);
        return error(401, 'SESSION_EXPIRED');
      }
      row.current = false;
      return json(200, issue(owner, row.family));
    }
    if (method === 'POST' && path === '/auth/logout') {
      const row = refreshRows.get(String(body.refreshToken));
      if (row) revokeFamily(row.family);
      return json(204);
    }
    const auth = authenticate(headers, path);
    if (auth.fail) return auth.fail;
    const { owner } = auth;
    if (method === 'POST' && path === '/auth/change-password') {
      if (body.currentPassword !== owner.password) return error(400, 'INVALID_CURRENT_PASSWORD');
      const next = String(body.newPassword);
      if (next.length < 8) return error(400, 'PASSWORD_POLICY', { rule: 'TOO_SHORT' });
      if (next.toLowerCase().includes(owner.loginId.toLowerCase())) {
        return error(400, 'PASSWORD_POLICY', { rule: 'CONTAINS_LOGIN_ID' });
      }
      if (next === 'password123') return error(400, 'PASSWORD_POLICY', { rule: 'TOO_COMMON' });
      owner.password = next;
      owner.mustChangePassword = false;
      for (const row of refreshRows.values()) if (row.userId === owner.id) revokeFamily(row.family);
      return json(200, issue(owner));
    }
    if (method === 'GET' && path === '/auth/me') {
      return json(200, {
        user: {
          id: owner.id,
          displayName: owner.displayName,
          preferredLanguage: owner.preferredLanguage,
          mustChangePassword: owner.mustChangePassword,
        },
        access: { permissions: owner.permissions, assignments: owner.assignments },
      });
    }
    // Step 4 dashboard tests use a bare total while no children are seeded.
    if (method === 'GET' && path.split('?')[0] === '/children' && childStore.children.size === 0) {
      if (!owner.permissions.includes('child.read')) return error(403, 'FORBIDDEN');
      return json(200, { items: [], page: 1, pageSize: 1, total: childrenTotal });
    }
    const childResult = childStore.route(method, path, body, owner.permissions);
    if (childResult) return json(childResult.status, childResult.body);
    if (method === 'GET' && path === '/probe') return json(200, { ok: true, user: owner.id });
    if (method === 'POST' && path === '/probe') return json(200, { ok: true });
    return error(404, 'NOT_FOUND');
  }

  const fetchFn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(TEST_BASE_URL, '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const method = init?.method ?? 'GET';
    calls.push({ method, path, url, headers, body });

    const queued = overrides.get(path)?.shift();
    if (offline || queued === 'network') throw new TypeError('Network request failed');
    if (queued === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    }
    const result = queued ?? route(method, path, headers, body);
    const text = result.body === undefined ? '' : JSON.stringify(result.body);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: { get: (name: string) => (name.toLowerCase() === 'x-request-id' ? 'req-test' : null) },
      text: async () => text,
    } as unknown as Response;
  });

  return {
    fetchFn,
    calls,
    user,
    children: childStore,
    /** Next response(s) for a path, consumed in order. */
    override(path: string, ...responses: Override[]) {
      overrides.set(path, [...(overrides.get(path) ?? []), ...responses]);
    },
    setOffline(value: boolean) {
      offline = value;
    },
    setAccessLifetime(seconds: number) {
      accessLifetimeSeconds = seconds;
    },
    setChildrenTotal(total: number) {
      childrenTotal = total;
    },
    /** Simulates access-token expiry on the server (the app's clock is not involved). */
    expireAccessTokens() {
      accessTokens.clear();
    },
    deactivate(loginId: string) {
      const found = users.get(loginId.toUpperCase());
      if (found) found.active = false;
    },
    callsTo(path: string) {
      return calls.filter((call) => call.path === path);
    },
    isRefreshTokenUsable(token: string) {
      const row = refreshRows.get(token);
      return Boolean(row && row.current && !row.revoked);
    },
  };
}

export type FakeBackend = ReturnType<typeof createFakeBackend>;
