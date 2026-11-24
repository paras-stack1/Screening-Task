import type {
  ParentAccount,
  ParentTokensResponse,
  ParentWebAuthResponse,
} from '@balswasthya/shared-contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isApiError } from '../api/http';
import { useServices } from '../services';
import { REFRESH_TOKEN_KEY } from '../storage';

/**
 * Parent session (Step 8, PP9).
 * - Access token: memory only, never stored.
 * - Refresh token: Android SecureStore; browser httpOnly cookie (never visible to scripts).
 * - On start the saved session is restored with one refresh; a 401 on any call triggers one refresh
 *   and a retry, otherwise the parent is signed out.
 * The API authorises every request on its own; this only decides which screens to show.
 */
type SessionState =
  | { status: 'restoring' }
  | { status: 'signedOut'; reason?: 'expired' }
  | { status: 'signedIn'; account: ParentAccount };

interface SessionValue {
  state: SessionState;
  signIn(phone: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  signOutEverywhere(): Promise<void>;
  /** Runs an authenticated call with the current access token (one refresh + retry on 401). */
  withToken<T>(call: (accessToken: string) => Promise<T>): Promise<T>;
  /** After a password change the API returns a new session. */
  adopt(tokens: ParentTokensResponse | ParentWebAuthResponse): Promise<void>;
  setAccount(account: ParentAccount): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { api, store, isWeb, queryClient, configured } = useServices();
  // Without an API address there is nothing to restore: start signed out (the screens explain it).
  const [state, setState] = useState<SessionState>(
    configured ? { status: 'restoring' } : { status: 'signedOut' },
  );
  const accessToken = useRef<string | null>(null);
  const refreshing = useRef<Promise<boolean> | null>(null);

  const adopt = useCallback(
    async (tokens: ParentTokensResponse | ParentWebAuthResponse) => {
      accessToken.current = tokens.accessToken;
      if (!isWeb && 'refreshToken' in tokens) await store.set(REFRESH_TOKEN_KEY, tokens.refreshToken);
      setState({ status: 'signedIn', account: tokens.account });
    },
    [isWeb, store],
  );

  const clear = useCallback(
    async (reason?: 'expired') => {
      accessToken.current = null;
      if (!isWeb) await store.remove(REFRESH_TOKEN_KEY);
      queryClient.clear();
      setState({ status: 'signedOut', reason });
    },
    [isWeb, queryClient, store],
  );

  /** One refresh at a time; true when a new access token was obtained. */
  const refresh = useCallback((): Promise<boolean> => {
    refreshing.current ??= (async () => {
      try {
        if (isWeb) {
          await adopt(await api.webRefresh());
          return true;
        }
        const saved = await store.get(REFRESH_TOKEN_KEY);
        if (!saved) return false;
        await adopt(await api.refresh(saved));
        return true;
      } catch (error) {
        if (isApiError(error) && error.kind === 'http' && error.status === 401) return false;
        throw error;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [adopt, api, isWeb, store]);

  useEffect(() => {
    if (!configured) return;
    refresh()
      .then((ok) => {
        if (!ok) return clear();
      })
      .catch(() => setState({ status: 'signedOut' }));
  }, [clear, configured, refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      state,
      async signIn(phone, password) {
        await adopt(isWeb ? await api.webLogin(phone, password) : await api.login(phone, password));
      },
      async signOut() {
        try {
          if (isWeb) await api.webLogout();
          else {
            const saved = await store.get(REFRESH_TOKEN_KEY);
            if (saved) await api.logout(saved);
          }
        } catch {
          // Signing out locally must work offline too; the server session then expires on its own.
        }
        await clear();
      },
      async signOutEverywhere() {
        if (accessToken.current) await api.logoutAll(accessToken.current);
        await clear();
      },
      async withToken(call) {
        if (!accessToken.current && !(await refresh())) {
          await clear('expired');
          throw new Error('signed out');
        }
        try {
          return await call(accessToken.current!);
        } catch (error) {
          if (!(isApiError(error) && error.status === 401)) throw error;
          if (!(await refresh())) {
            await clear('expired');
            throw error;
          }
          return call(accessToken.current!);
        }
      },
      adopt,
      setAccount(account) {
        setState({ status: 'signedIn', account });
      },
    }),
    [adopt, api, clear, isWeb, refresh, state, store],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
