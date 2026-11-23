import type { EffectiveAccess } from '@balswasthya/shared-contracts';

/**
 * An in-memory stand-in for the BalSwasthya API's sign-in endpoints, used through the portal's
 * real HTTP client (fetch is injected). It models the browser cookie jar: the refresh cookie is
 * only "sent" when the request uses credentials: 'include', and only rotated tokens are valid.
 * All data is synthetic.
 */
export const BASE_URL = 'http://api.test/api/v1';

export interface FakeUser {
  id: string;
  loginId: string;
  password: string;
  displayName: string;
  mustChangePassword: boolean;
  access: EffectiveAccess;
}

export const ADMIN_ACCESS: EffectiveAccess = {
  permissions: [
    'area.manage',
    'assignment.manage',
    'audit.read',
    'facility.manage',
    'report.aggregate',
    'user.manage',
  ],
  assignments: [
    {
      assignmentId: 'a-1',
      roleCode: 'STATE_ADMIN',
      scope: 'AREA_AND_DESCENDANTS',
      areaId: 'area-state',
      areaName: 'Demo State (synthetic)',
      areaNameHi: 'डेमो राज्य (कृत्रिम)',
      areaLevel: 'STATE',
      effectiveTo: null,
    },
  ],
};

export const WORKER_ACCESS: EffectiveAccess = {
  permissions: [
    'child.create',
    'child.read',
    'child.update',
    'consent.record',
    'referral.create',
    'screening.conduct',
  ],
  assignments: [
    {
      assignmentId: 'a-2',
      roleCode: 'ASHA',
      scope: 'AREA_ONLY',
      areaId: 'area-v1',
      areaName: 'Demo Village (synthetic)',
      areaNameHi: null,
      areaLevel: 'VILLAGE',
      effectiveTo: null,
    },
  ],
};

export interface RecordedCall {
  method: string;
  path: string;
  credentials: RequestCredentials | undefined;
  clientHeader: string | null;
  authorization: string | null;
  /** Parsed JSON body (undefined for none) and query string, for assertions. */
  body: unknown;
  search: string;
}

/** Extra endpoints (tests/support/fakeAdmin.ts). Returns null when the path is not handled. */
export type ExtraRoute = (request: {
  method: string;
  path: string;
  url: URL;
  body: unknown;
  caller: FakeUser | undefined;
}) => Response | null;

type Failure = 'network' | number;

function base64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class FakeServer {
  readonly users = new Map<string, FakeUser>();
  /** The browser's cookie jar for the refresh cookie (null = no cookie). */
  cookie: string | null = null;
  readonly calls: RecordedCall[] = [];
  /** Refresh token -> user id; rotated or revoked tokens are removed. */
  private readonly refreshTokens = new Map<string, string>();
  private readonly accessTokens = new Map<string, string>();
  private readonly failures = new Map<string, Failure[]>();
  private counter = 0;
  /** Access token lifetime in seconds (inside the fake JWT). */
  accessLifetimeSec = 900;
  extraRoutes: ExtraRoute | null = null;

  addUser(user: Omit<FakeUser, 'id'>): FakeUser {
    const full = { ...user, id: `user-${this.users.size + 1}` };
    this.users.set(user.loginId, full);
    return full;
  }

  /** The next call(s) to `path` fail with a network error or an HTTP status. */
  failNext(path: string, ...failures: Failure[]) {
    this.failures.set(path, [...(this.failures.get(path) ?? []), ...failures]);
  }

  /** Simulates access-token expiry/revocation on the server (the next use answers 401). */
  expireAccessTokens() {
    this.accessTokens.clear();
  }

  /** Simulates the session being ended elsewhere (password reset by an admin, logout-all). */
  revokeAllSessions() {
    this.refreshTokens.clear();
    this.accessTokens.clear();
  }

  callsTo(path: string): RecordedCall[] {
    return this.calls.filter((call) => call.path === path);
  }

  private userById(id: string): FakeUser | undefined {
    return [...this.users.values()].find((user) => user.id === id);
  }

  private issue(user: FakeUser, withCookie: boolean) {
    this.counter += 1;
    const iat = Math.floor(Date.now() / 1000);
    const access = `${base64Url('{"alg":"HS256"}')}.${base64Url(
      JSON.stringify({ sub: user.id, iat, exp: iat + this.accessLifetimeSec, jti: this.counter }),
    )}.sig`;
    const refresh = `refresh-${this.counter}`;
    this.accessTokens.set(access, user.id);
    this.refreshTokens.set(refresh, user.id);
    if (withCookie) this.cookie = refresh;
    return {
      accessToken: access,
      accessTokenExpiresAt: new Date((iat + this.accessLifetimeSec) * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      user: {
        id: user.id,
        displayName: user.displayName,
        preferredLanguage: 'en',
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace('/api/v1', '');
    const headers = new Headers(init.headers);
    const method = init.method ?? 'GET';
    this.calls.push({
      method,
      path,
      credentials: init.credentials,
      clientHeader: headers.get('x-balswasthya-client'),
      authorization: headers.get('authorization'),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      search: url.search,
    });

    const queued = this.failures.get(path);
    const failure = queued?.shift();
    if (failure === 'network') throw new TypeError('Failed to fetch');
    if (typeof failure === 'number') return json(failure, error('SERVER_ERROR'));

    const withCookie = init.credentials === 'include';
    const sentCookie = withCookie ? this.cookie : null;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, string>) : {};
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const caller = this.userById(this.accessTokens.get(bearer) ?? '');

    if (path.startsWith('/auth/web/') && headers.get('x-balswasthya-client') !== 'admin-portal') {
      return json(403, error('WEB_CLIENT_REQUIRED'));
    }

    const extra = this.extraRoutes?.({ method, path, url, body: this.calls.at(-1)!.body, caller });
    if (extra) return extra;

    switch (`${method} ${path}`) {
      case 'POST /auth/web/login': {
        const user = this.users.get((body.loginId ?? '').toUpperCase());
        if (!user || user.password !== body.password) return json(401, error('INVALID_CREDENTIALS'));
        return json(200, this.issue(user, withCookie));
      }
      case 'POST /auth/web/refresh': {
        const userId = sentCookie ? this.refreshTokens.get(sentCookie) : undefined;
        if (!sentCookie || !userId) {
          if (withCookie) this.cookie = null;
          return json(401, error('SESSION_EXPIRED'));
        }
        this.refreshTokens.delete(sentCookie);
        return json(200, this.issue(this.userById(userId)!, withCookie));
      }
      case 'POST /auth/web/logout': {
        if (sentCookie) this.refreshTokens.delete(sentCookie);
        if (withCookie) this.cookie = null;
        return new Response(null, { status: 204 });
      }
      case 'POST /auth/web/change-password': {
        if (!caller) return json(401, error('UNAUTHENTICATED'));
        if (body.currentPassword !== caller.password) return json(400, error('INVALID_CURRENT_PASSWORD'));
        if (body.newPassword === 'password123') {
          return json(400, error('PASSWORD_POLICY', { rule: 'TOO_COMMON' }));
        }
        caller.password = body.newPassword ?? '';
        caller.mustChangePassword = false;
        this.revokeAllSessions();
        return json(200, this.issue(caller, withCookie));
      }
      case 'GET /auth/me': {
        if (!caller) return json(401, error('UNAUTHENTICATED'));
        return json(200, {
          user: {
            id: caller.id,
            displayName: caller.displayName,
            preferredLanguage: 'en',
            mustChangePassword: caller.mustChangePassword,
          },
          access: caller.access,
        });
      }
      case 'GET /test/protected': {
        if (!caller) return json(401, error('UNAUTHENTICATED'));
        if (caller.mustChangePassword) return json(403, error('PASSWORD_CHANGE_REQUIRED'));
        return json(200, { ok: true });
      }
      default:
        return json(404, error('NOT_FOUND'));
    }
  };
}

export function error(code: string, details?: unknown) {
  return {
    error: { code, message: 'synthetic', ...(details !== undefined && { details }), requestId: 'req-test-1' },
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A server with one state administrator, one worker and one account needing a password change. */
export function standardServer(): FakeServer {
  const server = new FakeServer();
  server.addUser({
    loginId: 'ADMIN-0001',
    password: 'Synthetic-admin-2026',
    displayName: 'Synthetic State Admin',
    mustChangePassword: false,
    access: ADMIN_ACCESS,
  });
  server.addUser({
    loginId: 'ASHA-0001',
    password: 'Synthetic-asha-2026',
    displayName: 'Synthetic ASHA',
    mustChangePassword: false,
    access: WORKER_ACCESS,
  });
  server.addUser({
    loginId: 'ADMIN-NEW',
    password: 'TEMP-ABCD-EFGH',
    displayName: 'Synthetic New Admin',
    mustChangePassword: true,
    access: ADMIN_ACCESS,
  });
  return server;
}
