import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small key-value storage.
 * - Android: expo-secure-store (Keystore-encrypted, this device only).
 * - Browser: secrets are NEVER stored by script (the refresh token is an httpOnly cookie set by the
 *   API); only the language preference uses localStorage.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const REFRESH_TOKEN_KEY = 'bs.parent.refreshToken';
export const LANGUAGE_KEY = 'bs.parent.language';

const secure: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

/** Browser: only non-secret preferences (language). */
const browser: KeyValueStore = {
  get: (key) => {
    if (key !== LANGUAGE_KEY) return Promise.resolve(null);
    try {
      return Promise.resolve(globalThis.localStorage?.getItem(key) ?? null);
    } catch {
      return Promise.resolve(null);
    }
  },
  set: (key, value) => {
    if (key !== LANGUAGE_KEY) return Promise.resolve();
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // storage blocked: preference not kept
    }
    return Promise.resolve();
  },
  remove: (key) => {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // ignore
    }
    return Promise.resolve();
  },
};

export const deviceStore: KeyValueStore = Platform.OS === 'web' ? browser : secure;
