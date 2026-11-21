import type { QueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { appConfig, type AppConfig } from '../config/env';
import { createAuthApi, type AuthApi } from '../features/auth/services/authApi';
import { SessionManager } from '../features/auth/services/sessionManager';
import { createApiClient, type ApiClient } from './api/client';
import { createHttp } from './api/http';
import { createQueryClient } from './query/queryClient';
import { secureStorage, type KeyValueStore } from './storage/secureStorage';

/**
 * The app's long-lived services, created once. There is exactly one HTTP layer, one session and
 * one API client (no duplicates). Tests build their own with fakes via `createAppServices`.
 */
export interface AppServices {
  config: AppConfig;
  authApi: AuthApi;
  session: SessionManager;
  api: ApiClient;
  queryClient: QueryClient;
}

export interface AppServicesOptions {
  config?: AppConfig;
  store?: KeyValueStore;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function createAppServices({
  config = appConfig,
  store = secureStorage,
  fetchFn,
  now,
}: AppServicesOptions = {}): AppServices {
  const http = createHttp({
    baseUrl: config.api.ok ? config.api.url : null,
    timeoutMs: config.requestTimeoutMs,
    fetchFn,
  });
  const authApi = createAuthApi(http);
  const session = new SessionManager({ authApi, store, now });
  const queryClient = createQueryClient();
  // Account switch / logout / expiry: drop every cached server response immediately.
  session.onSessionEnd(() => queryClient.clear());
  return { config, authApi, session, api: createApiClient(http, session), queryClient };
}

let instance: AppServices | null = null;

/** Lazily created production services. */
export function getAppServices(): AppServices {
  if (!instance) instance = createAppServices();
  return instance;
}

const AppServicesContext = createContext<AppServices | null>(null);

export function AppServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) throw new Error('useAppServices must be used inside <AppServicesProvider>');
  return services;
}
