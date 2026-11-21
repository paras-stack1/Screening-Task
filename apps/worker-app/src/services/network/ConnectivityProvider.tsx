import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { connectQueryOnlineManager, useConnectivity, type Connectivity } from './connectivity';

const ConnectivityContext = createContext<Connectivity>('unknown');

/**
 * One network listener for the whole app. Also connects TanStack Query, so queries pause while
 * offline and resume afterwards.
 */
export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const connectivity = useConnectivity();
  useEffect(() => connectQueryOnlineManager(), []);
  return <ConnectivityContext.Provider value={connectivity}>{children}</ConnectivityContext.Provider>;
}

/** 'unknown' outside the provider (e.g. isolated component tests): no offline UI is shown. */
export function useConnectivityStatus(): Connectivity {
  return useContext(ConnectivityContext);
}
