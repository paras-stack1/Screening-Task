import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';

/**
 * Connectivity foundation (docs/frontend/offline.md). Detection only: no data is stored for
 * offline use in this phase and nothing is synchronised.
 */
export type Connectivity = 'online' | 'offline' | 'unknown';

/**
 * Offline only when the OS is sure: no connection, or a connection without internet (e.g. a
 * captive portal). "Unknown" (common for a moment at start-up) is not treated as offline, so
 * requests are not blocked on a guess; real failures still surface as network errors.
 */
export function toConnectivity(state: Network.NetworkState | undefined): Connectivity {
  if (!state) return 'unknown';
  if (state.isConnected === false || state.isInternetReachable === false) return 'offline';
  if (state.isConnected === true) return 'online';
  return 'unknown';
}

export function useConnectivity(): Connectivity {
  return toConnectivity(Network.useNetworkState());
}

/**
 * Tells TanStack Query when the device is offline: queries pause instead of failing and resume
 * when the connection returns. Call once at start-up; returns a cleanup function.
 */
export function connectQueryOnlineManager(): () => void {
  onlineManager.setEventListener((setOnline) => {
    const update = (state: Network.NetworkState) => setOnline(toConnectivity(state) !== 'offline');
    const subscription = Network.addNetworkStateListener(update);
    Network.getNetworkStateAsync()
      .then(update)
      .catch(() => undefined);
    return () => subscription.remove();
  });
  // Replacing the listener makes TanStack call the cleanup above (removes the subscription).
  return () => onlineManager.setEventListener(() => () => undefined);
}
