import {
  AUTH_ERROR_CODES,
  type AuthUser,
  type ChangePasswordRequest,
  type MeResponse,
  type WebAuthResponse,
} from '@balswasthya/shared-contracts';
import { ApiError, isApiError } from '../api/errors';
import { PORTAL_DEVICE_LABEL, type AuthApi } from './authApi';
import { noTabCoordination, type TabCoordination } from './tabCoordination';
import { accessTokenLifetimeMs } from './tokenLifetime';

/**
 * Session lifecycle of the admin portal (docs/admin-portal/README.md, decision P4).
 *
 * States:
 *  - initializing     first page load: trying to continue a session from the refresh cookie;
 *  - unauthenticated  no session (`reason`: signed out here or elsewhere, or the session ended);
 *  - restoreFailed    the API could not be reached on page load (retry offered);
 *  - authenticated    signed in, with the effective access from /auth/me (for the UI only -
 *                     the API checks every request again).
 *
 * Token handling: the access token lives in memory only. The refresh token is an httpOnly
 * cookie the portal cannot read; refreshing asks the browser to send it. Nothing is stored in
 * localStorage or sessionStorage, and nothing is logged.
 */
export type SessionEndReason = 'loggedOut' | 'sessionEnded';
export type EffectiveAccess = MeResponse['access'];

export type SessionState =
  | { status: 'initializing' }
  | { status: 'unauthenticated'; reason?: SessionEndReason }
  | { status: 'restoreFailed' }
  | { status: 'authenticated'; user: AuthUser; access: EffectiveAccess };

export interface SessionManagerDependencies {
  authApi: AuthApi;
  tabs?: TabCoordination;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
}

/** Refresh this long before the access token expires, so requests rarely meet a 401. */
const REFRESH_MARGIN_MS = 60_000;

/** The API rejected the session itself (401): retrying cannot help. */
function isSessionRejected(error: unknown): boolean {
  return isApiError(error) && error.kind === 'http' && error.status === 401;
}

export class SessionManager {
  private state: SessionState = { status: 'initializing' };
  private readonly listeners = new Set<() => void>();
  private readonly endListeners = new Set<(reason: SessionEndReason) => void>();
  private accessToken: { value: string; validUntil: number } | null = null;
  private refreshInFlight: Promise<string> | null = null;
  private restoreInFlight: Promise<void> | null = null;
  /**
   * Incremented whenever a session ends. A late result of an older generation is discarded, so a
   * slow response can never bring back a session the person signed out of.
   */
  private generation = 0;
  private readonly authApi: AuthApi;
  private readonly tabs: TabCoordination;
  private readonly now: () => number;
  private readonly stopListening: () => void;

  constructor({ authApi, tabs = noTabCoordination, now = Date.now }: SessionManagerDependencies) {
    this.authApi = authApi;
    this.tabs = tabs;
    this.now = now;
    this.stopListening = tabs.listen((message) => {
      if (message === 'signedOut' && this.state.status === 'authenticated') {
        this.endSession('loggedOut');
      } else if (message === 'signedIn' && this.state.status === 'unauthenticated') {
        // Another tab signed in: continue with the shared cookie instead of asking again.
        this.restoreInFlight = this.restore(true);
      }
    });
  }

  dispose() {
    this.stopListening();
  }

  // ---- observation (useSyncExternalStore) -----------------------------------------------------

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called when a session ends - used to drop cached server data. */
  onSessionEnd(listener: (reason: SessionEndReason) => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  private setState(next: SessionState) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  // ---- page load -------------------------------------------------------------------------------

  /** Continues an existing session from the cookie, once. Safe to call repeatedly. */
  initialize(): Promise<void> {
    if (!this.restoreInFlight) this.restoreInFlight = this.restore(false);
    return this.restoreInFlight;
  }

  retryRestore(): Promise<void> {
    if (this.state.status !== 'restoreFailed') return this.restoreInFlight ?? Promise.resolve();
    this.restoreInFlight = this.restore(false);
    return this.restoreInFlight;
  }

  private async restore(quiet: boolean): Promise<void> {
    if (!quiet) this.setState({ status: 'initializing' });
    const generation = this.generation;
    try {
      const tokens = await this.tabs.exclusive(() => this.authApi.refresh());
      if (generation !== this.generation) return;
      await this.accept(tokens, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      if (isSessionRejected(error)) {
        // No cookie, or an ended session: simply signed out (no message on a fresh visit).
        this.setState({ status: 'unauthenticated' });
      } else if (!quiet) {
        this.setState({ status: 'restoreFailed' });
      }
    }
  }

  // ---- sign in / out ---------------------------------------------------------------------------

  /** Throws ApiError on failure; the page shows a translated message. The password is not kept. */
  async login(loginId: string, password: string): Promise<void> {
    const generation = this.generation;
    const tokens = await this.authApi.login({ loginId, password, deviceLabel: PORTAL_DEVICE_LABEL });
    if (generation !== this.generation) return;
    await this.accept(tokens, generation);
    this.tabs.announce('signedIn');
  }

  /**
   * Signs out: this tab forgets the access token at once, the other tabs are told, and the server
   * revokes the session and clears the cookie (best effort - if the API is unreachable, the
   * session still ends here and the cookie expires on its own).
   */
  async logout(): Promise<void> {
    this.endSession('loggedOut');
    this.tabs.announce('signedOut');
    await this.authApi.logout().catch(() => undefined);
  }

  /** The API revokes every session and starts a new one; the new cookie replaces the old one. */
  async changePassword(input: ChangePasswordRequest): Promise<void> {
    const generation = this.generation;
    const tokens = await this.authorized((token) => this.authApi.changePassword(token, input));
    if (generation !== this.generation) return;
    await this.accept(tokens, generation);
  }

  // ---- tokens for API calls --------------------------------------------------------------------

  async getAccessToken(): Promise<string> {
    const token = this.accessToken;
    if (this.state.status !== 'authenticated' || !token) throw new ApiError('noSession');
    if (this.now() < token.validUntil - REFRESH_MARGIN_MS) return token.value;
    return this.refresh();
  }

  /**
   * Runs an authenticated call. On 401 it refreshes ONCE and retries ONCE; a second 401 ends the
   * session. A 401 means the API refused before doing anything, so one retry is safe for writes.
   */
  async authorized<T>(call: (accessToken: string) => Promise<T>): Promise<T> {
    const token = await this.getAccessToken();
    try {
      return await call(token);
    } catch (error) {
      if (!isSessionRejected(error)) {
        this.inspect(error);
        throw error;
      }
    }
    const fresh = await this.refreshAfterUnauthorized(token);
    try {
      return await call(fresh);
    } catch (error) {
      if (isSessionRejected(error)) this.endSession('sessionEnded');
      this.inspect(error);
      throw error;
    }
  }

  /** Single-flight within the tab, one-at-a-time across tabs (the cookie rotates on every use). */
  refresh(): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (this.state.status !== 'authenticated') return Promise.reject(new ApiError('noSession'));
    const attempt = this.runRefresh(this.generation);
    this.refreshInFlight = attempt;
    const clear = () => {
      if (this.refreshInFlight === attempt) this.refreshInFlight = null;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  private async runRefresh(generation: number): Promise<string> {
    try {
      const tokens = await this.tabs.exclusive(() => this.authApi.refresh());
      if (generation !== this.generation) throw new ApiError('noSession');
      this.storeAccessToken(tokens);
      if (
        this.state.status === 'authenticated' &&
        tokens.user.mustChangePassword !== this.state.user.mustChangePassword
      ) {
        this.setState({ ...this.state, user: tokens.user });
      }
      return tokens.accessToken;
    } catch (error) {
      if (generation === this.generation && isSessionRejected(error)) this.endSession('sessionEnded');
      throw error;
    }
  }

  private refreshAfterUnauthorized(rejected: string): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (this.accessToken && this.accessToken.value !== rejected)
      return Promise.resolve(this.accessToken.value);
    return this.refresh();
  }

  // ---- internals -------------------------------------------------------------------------------

  private inspect(error: unknown) {
    if (
      isApiError(error) &&
      error.status === 403 &&
      error.code === AUTH_ERROR_CODES.passwordChangeRequired &&
      this.state.status === 'authenticated' &&
      !this.state.user.mustChangePassword
    ) {
      this.setState({ ...this.state, user: { ...this.state.user, mustChangePassword: true } });
    }
  }

  private storeAccessToken(tokens: WebAuthResponse) {
    this.accessToken = {
      value: tokens.accessToken,
      validUntil: this.now() + accessTokenLifetimeMs(tokens.accessToken),
    };
  }

  /** New tokens: keep the access token, then load the person's effective access. */
  private async accept(tokens: WebAuthResponse, generation: number) {
    this.storeAccessToken(tokens);
    const me = await this.authApi.me(tokens.accessToken);
    if (generation !== this.generation) return;
    this.setState({ status: 'authenticated', user: me.user, access: me.access });
  }

  private endSession(reason: SessionEndReason) {
    this.generation += 1;
    this.accessToken = null;
    this.refreshInFlight = null;
    this.restoreInFlight = Promise.resolve();
    this.setState({ status: 'unauthenticated', reason });
    this.endListeners.forEach((listener) => listener(reason));
  }
}

/** Permissions that open the portal (decision P2). */
export const PORTAL_PERMISSIONS = ['user.manage', 'assignment.manage'] as const;

export function canUsePortal(access: EffectiveAccess): boolean {
  return access.permissions.some((p) => (PORTAL_PERMISSIONS as readonly string[]).includes(p));
}
