import { onlineManager } from '@tanstack/react-query';
import { connectQueryOnlineManager, toConnectivity } from '../../src/services/network/connectivity';
import { network, OFFLINE, ONLINE } from '../support/mockNetwork';

jest.mock('expo-network', () => require('../support/mockNetwork').expoNetworkMock);

describe('toConnectivity', () => {
  it.each([
    [{ isConnected: true, isInternetReachable: true }, 'online'],
    [{ isConnected: true }, 'online'],
    [{ isConnected: false }, 'offline'],
    [{ isConnected: true, isInternetReachable: false }, 'offline'], // captive portal
    [{}, 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%p -> %s', (state, expected) => {
    expect(toConnectivity(state)).toBe(expected);
  });
});

describe('connectQueryOnlineManager', () => {
  afterEach(() => {
    network.reset();
    onlineManager.setOnline(true);
  });

  it('pauses TanStack Query while offline and resumes when back online', async () => {
    const disconnect = connectQueryOnlineManager();
    network.set(OFFLINE);
    expect(onlineManager.isOnline()).toBe(false);
    network.set(ONLINE);
    expect(onlineManager.isOnline()).toBe(true);
    disconnect();
  });

  it('removes its network listener on cleanup (no leak)', () => {
    const before = network.listenerCount();
    const disconnect = connectQueryOnlineManager();
    expect(network.listenerCount()).toBe(before + 1);
    disconnect();
    expect(network.listenerCount()).toBe(before);
  });

  it('does not treat an unknown state as offline', () => {
    const disconnect = connectQueryOnlineManager();
    network.set({});
    expect(onlineManager.isOnline()).toBe(true);
    disconnect();
  });
});
