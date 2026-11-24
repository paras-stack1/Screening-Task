import type { ParentChild } from '@balswasthya/shared-contracts';
import { createAppServices, type AppServices } from '../../src/services';
import type { KeyValueStore } from '../../src/storage';

/**
 * In-memory stand-in for the Parent Portal API (docs/api/parent-portal.md), for tests only.
 * Synthetic data. Mimics the rules the app depends on: one code per send, attempts left, the same
 * answer for unknown numbers, refresh rotation and 401 for an expired access token.
 */
export const VALID_TOKEN = 'A'.repeat(43);
export const CODE = '482913';
export const PHONE = '+919811122233';
export const PASSWORD = 'Neem-tree-by-the-well-42';

export function child(overrides: Partial<ParentChild> = {}): ParentChild {
  return {
    childId: '00000000-0000-4000-8000-0000000000c1',
    fullName: 'Aarav Kumar',
    ageYears: 4,
    ageMonths: 2,
    dobIsEstimated: false,
    centre: { nameEn: 'Rampur AWC (synthetic)', nameHi: 'रामपुर आंगनवाड़ी (कृत्रिम)' },
    workerName: 'Synthetic ASHA Sunita',
    nextCheckUp: '2026-12-15',
    nextAppointment: null,
    ...overrides,
  };
}

export function createMemoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => Promise.resolve(data.get(k) ?? null),
    set: (k, v) => {
      data.set(k, v);
      return Promise.resolve();
    },
    remove: (k) => {
      data.delete(k);
      return Promise.resolve();
    },
  };
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
  auth: string | undefined;
}

export function createFakeParentApi() {
  const state = {
    invitationValid: true,
    attemptsLeft: 5,
    activated: false,
    password: PASSWORD,
    children: [child()],
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    seq: 1,
    /** Next authenticated call answers 401 once (expired access token). */
    expireAccessOnce: false,
    calls: [] as Call[],
  };
  const account = () => ({
    id: '00000000-0000-4000-8000-0000000000a1',
    role: 'PARENT_GUARDIAN' as const,
    guardianName: 'Synthetic Priya Kumari',
    maskedPhone: '********2233',
    activatedAt: '2026-11-21T09:00:00.000Z',
    passwordChangedAt: '2026-11-21T09:00:00.000Z',
    privacyNoticeVersion: 'draft-1',
    termsVersion: 'draft-1',
    childCount: state.children.length,
  });
  const issue = () => {
    state.seq += 1;
    state.accessToken = `access-${state.seq}`;
    state.refreshToken = `refresh-${state.seq}`;
    return {
      accessToken: state.accessToken,
      accessTokenExpiresAt: '2026-11-21T09:15:00.000Z',
      refreshToken: state.refreshToken,
      refreshTokenExpiresAt: '2026-12-21T09:00:00.000Z',
      account: account(),
    };
  };
  const err = (status: number, code: string, details?: unknown) => ({
    status,
    body: {
      error: { code, message: 'generic', requestId: 'req-test', ...(details !== undefined && { details }) },
    },
  });

  function handle(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    auth: string | undefined,
  ) {
    const authed = () => {
      if (state.expireAccessOnce) {
        state.expireAccessOnce = false;
        return false;
      }
      return auth === `Bearer ${state.accessToken}`;
    };
    switch (`${method} ${path.split('?')[0]}`) {
      case 'GET /parent/legal':
        return {
          status: 200,
          body: {
            privacyNotice: {
              kind: 'PRIVACY_NOTICE',
              version: 'draft-1',
              language: 'hi',
              title: 'Privacy',
              text: 'Synthetic privacy text',
              isPlaceholder: true,
            },
            terms: {
              kind: 'TERMS',
              version: 'draft-1',
              language: 'hi',
              title: 'Terms',
              text: 'Synthetic terms text',
              isPlaceholder: true,
            },
          },
        };
      case 'POST /parent/invitations/validate':
        return body?.token === VALID_TOKEN && state.invitationValid && !state.activated
          ? {
              status: 200,
              body: {
                valid: true,
                maskedPhone: '********2233',
                expiresAt: '2026-11-22T09:00:00.000Z',
                phoneVerified: false,
              },
            }
          : err(404, 'INVITATION_INVALID');
      case 'POST /parent/invitations/send-otp':
        state.attemptsLeft = 5;
        return {
          status: 200,
          body: {
            sent: true,
            maskedPhone: '********2233',
            expiresAt: '2026-11-21T09:05:00.000Z',
            resendAfter: '2026-11-21T09:01:00.000Z',
          },
        };
      case 'POST /parent/invitations/verify-otp':
        if (body?.code !== CODE) {
          state.attemptsLeft -= 1;
          return err(400, 'OTP_INVALID', { attemptsLeft: state.attemptsLeft });
        }
        return {
          status: 200,
          body: { verified: true, activationTicket: 'ticket-1', ticketExpiresAt: '2026-11-21T09:15:00.000Z' },
        };
      case 'POST /parent/activate':
        if (body?.activationTicket !== 'ticket-1') return err(403, 'PHONE_NOT_VERIFIED');
        if (body.acceptPrivacyNotice !== true || body.acceptTerms !== true)
          return err(400, 'VALIDATION_ERROR');
        state.activated = true;
        state.password = String(body.password);
        return { status: 201, body: { activated: true, maskedPhone: '********2233' } };
      case 'POST /parent/auth/login':
        return body?.phone === PHONE && body.password === state.password
          ? { status: 200, body: issue() }
          : err(401, 'INVALID_CREDENTIALS');
      case 'POST /parent/auth/refresh':
        return body?.refreshToken === state.refreshToken
          ? { status: 200, body: issue() }
          : err(401, 'SESSION_EXPIRED');
      case 'POST /parent/auth/logout':
        state.refreshToken = 'logged-out';
        return { status: 204 };
      case 'POST /parent/auth/forgot-password':
        return {
          status: 202,
          body: {
            accepted: true,
            message: 'If an account exists for this number, a code has been sent to it.',
          },
        };
      case 'GET /parent/auth/me':
        return authed() ? { status: 200, body: { account: account() } } : err(401, 'UNAUTHENTICATED');
      case 'GET /parent/children':
        return authed() ? { status: 200, body: { children: state.children } } : err(401, 'UNAUTHENTICATED');
      default: {
        const m = /^\/parent\/children\/(.+)$/.exec(path);
        if (method === 'GET' && m) {
          if (!authed()) return err(401, 'UNAUTHENTICATED');
          const c = state.children.find((x) => x.childId === m[1]);
          return c
            ? {
                status: 200,
                body: {
                  child: {
                    ...c,
                    upcomingCheckUps: c.nextCheckUp ? [c.nextCheckUp] : [],
                    upcomingAppointments: [],
                  },
                },
              }
            : err(404, 'NOT_FOUND');
        }
        return err(404, 'NOT_FOUND');
      }
    }
  }

  const fetchFn = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const headers = (init.headers ?? {}) as Record<string, string>;
    const method = init.method ?? 'GET';
    state.calls.push({ method, path, body, auth: headers.Authorization });
    const result = handle(method, path, body, headers.Authorization);
    const text = result.body === undefined ? '' : JSON.stringify(result.body);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: { get: () => null },
      text: async () => text,
    } as unknown as Response;
  });

  return { state, fetchFn };
}

export function createTestServices(): {
  services: AppServices;
  backend: ReturnType<typeof createFakeParentApi>;
  store: ReturnType<typeof createMemoryStore>;
} {
  const backend = createFakeParentApi();
  const store = createMemoryStore();
  const services = createAppServices({
    fetchFn: backend.fetchFn as unknown as typeof fetch,
    store,
    isWeb: false,
    configured: true,
  });
  return { services, backend, store };
}
