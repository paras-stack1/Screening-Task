import {
  AUTH_ERROR_CODES,
  type AuthTokensResponse,
  type AuthUser,
  type ChangePasswordRequest,
} from '@balswasthya/shared-contracts';
import { ApiError, isApiError } from '../../../services/api/errors';
import { storageKeys, type KeyValueStore } from '../../../services/storage/secureStorage';
import { accessTokenLifetimeMs } from './accessTokenLifetime';
import { defaultDeviceLabel, type AuthApi } from './authApi';

/**
 * Session lifecycle for the worker app (docs/frontend/authentication.md).
 *
 * UI-visible states:
 *  - initializing     reading the saved session / first refresh. Protected UI is not rendered.
 *  - unauthenticated  no session. `reason` explains why (logged out, or session ended/expired).
 *  - restoreFailed    a session is saved but the server could not be reached (decision M).
 *  - authenticated    signed in. `user.mustChangePassword` routes to the change-password screen.
 * "Refreshing" is an internal, invisible activity (single-flight), not a screen state.
 *
 * Token handling:
 *  - Access token: memory only, never persisted (decision K).
 *  - Refresh token: memory + SecureStore. A rotated token is saved before it is used again.
 *  - Never logged. Errors never contain token values.
 */
export type SessionEndReason = 'loggedOut' | 'sessionEnded';

export type SessionState =
  | { status: 'initializing' }
  | { status: 'unauthenticated'; reason?: SessionEndReason }
  | { status: 'restoreFailed' }
  | { status: 'authenticated'; user: AuthUser };

export interface SessionManagerDependencies {
  authApi: AuthApi;
  store: KeyValueStore;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
  deviceLabel?: () => string;
}

interface Tokens {
  accessToken: string;
  /** Device-clock time after which the access token is treated as expired. */
  accessValidUntil: number;
  refreshToken: string;
}

/** Refresh this long before the access token expires, so requests rarely meet a 401. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * The server rejected the credentials themselves: retrying cannot help, the session is over.
 * 401 = unknown/expired/revoked/reused token or inactive account; 400 = malformed token.
 */
function isPermanentAuthFailure(error: unknown): boolean {
  return isApiError(error) && error.kind === 'http' && (error.status === 401 || error.status === 400);
}

function isPasswordChangeRequired(error: unknown): boolean {
  return isApiError(error) && error.status === 403 && error.code === AUTH_ERROR_CODES.passwordChangeRequired;
}

export class SessionManager {
  private state: SessionState = { status: 'initializing' };
  private readonly listeners = new Set<() => void>();
  private readonly endListeners = new Set<(reason: SessionEndReason) => void>();
  private tokens: Tokens | null = null;
  private refreshInFlight: Promise<string> | null = null;
  private restoreInFlight: Promise<void> | null = null;
  /**
   * Incremented whenever a session ends. An async result (refresh, login) that started under an
   * older generation is discarded, so a late response can never resurrect a logged-out session.
   */
  private generation = 0;
  private readonly authApi: AuthApi;
  private readonly store: KeyValueStore;
  private readonly now: () => number;
  private readonly deviceLabel: () => string;

  constructor({
    authApi,
    store,
    now = Date.now,
    deviceLabel = defaultDeviceLabel,
  }: SessionManagerDependencies) {
    this.authApi = authApi;
    this.store = store;
    this.now = now;
    this.deviceLabel = deviceLabel;
  }

  // ---- observation (useSyncExternalStore) ---------------------------------------------------

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called synchronously when a session ends - used to clear cached server data (account switch). */
  onSessionEnd(listener: (reason: SessionEndReason) => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  private setState(next: SessionState) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  // ---- start-up ------------------------------------------------------------------------------

  /** Restores a saved session once. Safe to call repeatedly (returns the same promise). */
  initialize(): Promise<void> {
    if (!this.restoreInFlight) this.restoreInFlight = this.restore();
    return this.restoreInFlight;
  }

  /** From `restoreFailed`: try to reach the server again. */
  retryRestore(): Promise<void> {
    if (this.state.status !== 'restoreFailed') return this.restoreInFlight ?? Promise.resolve();
    this.restoreInFlight = this.restore();
    return this.restoreInFlight;
  }

  private async restore(): Promise<void> {
    this.setState({ status: 'initializing' });
    const generation = this.generation;

    let saved: string | null = null;
    try {
      saved = await this.store.getItem(storageKeys.refreshToken);
    } catch {
      // Unreadable storage (the wrapper already removed the entry): start signed out.
      saved = null;
    }
    if (generation !== this.generation) return;
    if (!saved) {
      this.setState({ status: 'unauthenticated' });
      return;
    }

    try {
      const response = await this.authApi.refresh(saved);
      if (generation !== this.generation) {
        this.revokeQuietly(response.refreshToken);
        return;
      }
      await this.acceptTokens(response);
    } catch (error) {
      if (generation !== this.generation) return;
      if (isPermanentAuthFailure(error)) {
        await this.deleteStoredToken();
        this.setState({ status: 'unauthenticated', reason: 'sessionEnded' });
      } else {
        // Offline, timeout, rate limit or server fault: keep the saved session (decision M).
        this.setState({ status: 'restoreFailed' });
      }
    }
  }

  // ---- sign in / out -------------------------------------------------------------------------

  /** Throws ApiError on failure; the caller shows a translated message. The password is not kept. */
  async login(loginId: string, password: string): Promise<void> {
    const generation = this.generation;
    const response = await this.authApi.login({ loginId, password, deviceLabel: this.deviceLabel() });
    if (generation !== this.generation) {
      this.revokeQuietly(response.refreshToken);
      return;
    }
    await this.acceptTokens(response);
  }

  /**
   * Ends the session on this device (decision P). Local credentials are cleared first, so logout
   * works offline; the server revocation is best effort.
   */
  async logout(): Promise<void> {
    let refreshToken = this.tokens?.refreshToken ?? null;
    if (!refreshToken) {
      refreshToken = await this.store.getItem(storageKeys.refreshToken).catch(() => null);
    }
    await this.endSession('loggedOut');
    if (refreshToken) await this.authApi.logout(refreshToken).catch(() => undefined);
  }

  /**
   * Changes the password. The server revokes every session of the user and starts a new one for
   * this device, so the returned tokens replace the current ones.
   */
  async changePassword(input: ChangePasswordRequest): Promise<void> {
    const generation = this.generation;
    const response = await this.authorized((token) => this.authApi.changePassword(token, input));
    if (generation !== this.generation) return;
    await this.acceptTokens(response);
  }

  // ---- tokens for API calls ------------------------------------------------------------------

  /** A currently valid access token, refreshing first if it is about to expire. */
  async getAccessToken(): Promise<string> {
    const tokens = this.tokens;
    if (this.state.status !== 'authenticated' || !tokens) throw new ApiError('noSession');
    if (this.now() < tokens.accessValidUntil - REFRESH_MARGIN_MS) return tokens.accessToken;
    return this.refresh();
  }

  /**
   * Runs an authenticated call. On 401 it refreshes ONCE and retries ONCE; a second 401 ends the
   * session. There is no other retry, so no loop is possible. A 401 means the API rejected the
   * request before running it, so the single retry is safe even for POST.
   */
  async authorized<T>(call: (accessToken: string) => Promise<T>): Promise<T> {
    const token = await this.getAccessToken();
    try {
      return await call(token);
    } catch (error) {
      if (!(isApiError(error) && error.status === 401)) {
        this.inspect(error);
        throw error;
      }
    }

    const fresh = await this.refreshAfterUnauthorized(token);
    try {
      return await call(fresh);
    } catch (error) {
      if (isApiError(error) && error.status === 401) await this.endSession('sessionEnded');
      this.inspect(error);
      throw error;
    }
  }

  /** Single-flight refresh: concurrent callers share one request (the server rotates tokens). */
  refresh(): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const current = this.tokens;
    if (!current) return Promise.reject(new ApiError('noSession'));

    const attempt = this.runRefresh(current.refreshToken, this.generation);
    this.refreshInFlight = attempt;
    // Only clear our own attempt: a newer session may already have started another refresh.
    const clear = () => {
      if (this.refreshInFlight === attempt) this.refreshInFlight = null;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  private async runRefresh(refreshToken: string, generation: number): Promise<string> {
    try {
      const response = await this.authApi.refresh(refreshToken);
      if (generation !== this.generation) {
        this.revokeQuietly(response.refreshToken);
        throw new ApiError('noSession');
      }
      await this.acceptTokens(response);
      return response.accessToken;
    } catch (error) {
      if (generation === this.generation && isPermanentAuthFailure(error)) {
        await this.endSession('sessionEnded');
      }
      // Transient failures (offline, timeout, 5xx) keep the session; the next call tries again.
      throw error;
    }
  }

  /** After a 401: refresh unless another caller already replaced the rejected token. */
  private refreshAfterUnauthorized(rejectedToken: string): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (this.tokens && this.tokens.accessToken !== rejectedToken)
      return Promise.resolve(this.tokens.accessToken);
    return this.refresh();
  }

  // ---- internals -----------------------------------------------------------------------------

  private inspect(error: unknown) {
    if (isPasswordChangeRequired(error) && this.state.status === 'authenticated') {
      if (!this.state.user.mustChangePassword) {
        this.setState({ status: 'authenticated', user: { ...this.state.user, mustChangePassword: true } });
      }
    }
  }

  private async acceptTokens(response: AuthTokensResponse) {
    // Memory first (synchronously), so any concurrent caller sees the newest token.
    this.tokens = {
      accessToken: response.accessToken,
      accessValidUntil: this.now() + accessTokenLifetimeMs(response.accessToken),
      refreshToken: response.refreshToken,
    };
    try {
      await this.store.setItem(storageKeys.refreshToken, response.refreshToken);
    } catch {
      // Could not persist: the session still works now but will not survive an app restart.
    }
    this.setState({ status: 'authenticated', user: response.user });
  }

  private async endSession(reason: SessionEndReason) {
    this.generation += 1;
    this.tokens = null;
    this.refreshInFlight = null;
    this.restoreInFlight = Promise.resolve();
    this.setState({ status: 'unauthenticated', reason });
    this.endListeners.forEach((listener) => listener(reason));
    await this.deleteStoredToken();
  }

  private async deleteStoredToken() {
    await this.store.deleteItem(storageKeys.refreshToken).catch(() => undefined);
  }

  /** A token obtained after the session ended is revoked on the server instead of being kept. */
  private revokeQuietly(refreshToken: string) {
    this.authApi.logout(refreshToken).catch(() => undefined);
  }
}
