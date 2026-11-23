import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from '../api/client';
import { isApiError } from '../api/errors';
import { createHttp } from '../api/http';
import { createAuthApi } from '../auth/authApi';
import { SessionManager, type SessionState } from '../auth/sessionManager';
import { createBrowserTabCoordination, type TabCoordination } from '../auth/tabCoordination';
import { config } from '../config';

export interface PortalServices {
  session: SessionManager;
  api: ApiClient;
  queryClient: QueryClient;
  apiConfigured: boolean;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Never retry a refused request; one retry for "no response" or server faults.
        retry: (failureCount, error) =>
          failureCount < 1 && !(isApiError(error) && error.kind === 'http' && (error.status ?? 0) < 500),
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export function createPortalServices(options: {
  apiBaseUrl: string | null;
  fetchFn?: typeof fetch;
  tabs?: TabCoordination;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
}): PortalServices {
  const request = createHttp({ baseUrl: options.apiBaseUrl, fetchFn: options.fetchFn });
  const session = new SessionManager({
    authApi: createAuthApi(request),
    tabs: options.tabs,
    now: options.now,
  });
  const queryClient = createQueryClient();
  // A new person may sign in next: nothing cached for the previous one may remain visible.
  session.onSessionEnd(() => queryClient.clear());
  return {
    session,
    api: createApiClient(request, session),
    queryClient,
    apiConfigured: options.apiBaseUrl !== null,
  };
}

export function createBrowserServices(): PortalServices {
  return createPortalServices({ apiBaseUrl: config.apiBaseUrl, tabs: createBrowserTabCoordination() });
}

const ServicesContext = createContext<PortalServices | null>(null);

export function ServicesProvider({ services, children }: { services: PortalServices; children: ReactNode }) {
  useEffect(() => {
    if (services.apiConfigured) void services.session.initialize();
  }, [services]);
  return (
    <ServicesContext.Provider value={services}>
      <QueryClientProvider client={services.queryClient}>{children}</QueryClientProvider>
    </ServicesContext.Provider>
  );
}

export function useServices(): PortalServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside ServicesProvider');
  return services;
}

export function useSessionState(): SessionState {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getState);
}

/** Lazily creates the browser services once per page. */
export function useBrowserServices(): PortalServices {
  const [services] = useState(createBrowserServices);
  return services;
}
