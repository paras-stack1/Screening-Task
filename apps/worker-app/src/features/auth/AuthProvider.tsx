import type { AuthUser, ChangePasswordRequest } from '@balswasthya/shared-contracts';
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from '../../localization';
import type { SessionManager, SessionState } from './services/sessionManager';

export interface AuthContextValue {
  state: SessionState;
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (input: ChangePasswordRequest) => Promise<void>;
  retryRestore: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Exposes the SessionManager to React. Holds no tokens itself: the UI only ever sees the
 * session state and the signed-in user's public fields.
 */
export function AuthProvider({ session, children }: { session: SessionManager; children: ReactNode }) {
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const { applyAccountLanguage } = useTranslation();

  useEffect(() => {
    // initialize() is idempotent, so a re-mount (or React strict mode) restores only once.
    session.initialize().catch(() => undefined);
  }, [session]);

  const userId = state.status === 'authenticated' ? state.user.id : null;
  const preferredLanguage = state.status === 'authenticated' ? state.user.preferredLanguage : null;
  useEffect(() => {
    // Decision G: the account language applies only if no language was chosen on this device.
    if (userId && preferredLanguage) applyAccountLanguage(preferredLanguage);
  }, [userId, preferredLanguage, applyAccountLanguage]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login: (loginId, password) => session.login(loginId, password),
      logout: () => session.logout(),
      changePassword: (input) => session.changePassword(input),
      retryRestore: () => session.retryRestore(),
    }),
    [state, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * The signed-in user, for screens inside the protected (app) routes. Display only: the API checks
 * permissions on every request; nothing here is an authorization decision.
 *
 * Returns null (never throws): during sign-out a protected screen can render once more before the
 * navigator removes it, and it must then render nothing rather than crash.
 */
export function useAuthenticatedUser(): AuthUser | null {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.user : null;
}
