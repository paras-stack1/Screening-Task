import { QueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { createParentApi, type ParentApi } from './api/parentApi';
import { createHttp } from './api/http';
import { appConfig } from './config';
import { deviceStore, type KeyValueStore } from './storage';

/** Everything with side effects, created once and replaceable in tests. */
export interface AppServices {
  api: ParentApi;
  store: KeyValueStore;
  isWeb: boolean;
  configured: boolean;
  queryClient: QueryClient;
}

export function createAppServices(
  overrides: Partial<AppServices> & { fetchFn?: typeof fetch } = {},
): AppServices {
  const { fetchFn, ...rest } = overrides;
  const http = createHttp({
    baseUrl: appConfig.api.ok ? appConfig.api.url : null,
    timeoutMs: appConfig.requestTimeoutMs,
    fetchFn,
  });
  return {
    api: createParentApi(http),
    store: deviceStore,
    isWeb: appConfig.isWeb,
    configured: appConfig.api.ok,
    // Child data is kept in memory only and never retried blindly on 4xx.
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
    ...rest,
  };
}

let singleton: AppServices | null = null;
/** Tests replace this through jest.mock. */
export function getAppServices(): AppServices {
  singleton ??= createAppServices();
  return singleton;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const value = useContext(ServicesContext);
  if (!value) throw new Error('useServices outside ServicesProvider');
  return value;
}
