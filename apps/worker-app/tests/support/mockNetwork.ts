import { useSyncExternalStore } from 'react';

/**
 * Controllable stand-in for expo-network (tests only). Use with:
 *   jest.mock('expo-network', () => require('../support/mockNetwork').expoNetworkMock);
 * and change the state inside act(): `await act(async () => network.set(OFFLINE))`.
 */
export interface MockNetworkState {
  isConnected?: boolean;
  isInternetReachable?: boolean;
  type?: string;
}

export const ONLINE: MockNetworkState = { isConnected: true, isInternetReachable: true, type: 'WIFI' };
export const OFFLINE: MockNetworkState = { isConnected: false, isInternetReachable: false, type: 'NONE' };

let state: MockNetworkState = ONLINE;
const listeners = new Set<(next: MockNetworkState) => void>();

export const network = {
  set(next: MockNetworkState) {
    state = next;
    listeners.forEach((listener) => listener(state));
  },
  reset() {
    state = ONLINE;
  },
  listenerCount: () => listeners.size,
};

function subscribe(onChange: () => void) {
  const listener = () => onChange();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const expoNetworkMock = {
  NetworkStateType: { NONE: 'NONE', WIFI: 'WIFI', CELLULAR: 'CELLULAR', UNKNOWN: 'UNKNOWN' },
  useNetworkState: () => useSyncExternalStore(subscribe, () => state),
  addNetworkStateListener: (listener: (next: MockNetworkState) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
  getNetworkStateAsync: async () => state,
};
