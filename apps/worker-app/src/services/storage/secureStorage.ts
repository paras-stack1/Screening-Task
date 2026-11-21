import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The ONLY persistent key-value store in the app (docs/frontend/security.md).
 *
 * - Android/iOS: Expo SecureStore (Android Keystore / iOS Keychain). The expo-secure-store config
 *   plugin excludes these values from Android Auto Backup, so they never leave the device.
 * - Web: in-memory only (decision F). Web is a development target; nothing survives a reload.
 *
 * Errors never include the stored value. Callers decide whether a failure is fatal.
 */
export interface KeyValueStore {
  getItem(key: StorageKey): Promise<string | null>;
  setItem(key: StorageKey, value: string): Promise<void>;
  deleteItem(key: StorageKey): Promise<void>;
}

/** Every key the app stores. SecureStore keys may only contain letters, digits, '.', '-' and '_'. */
export const storageKeys = {
  /** Language explicitly chosen on this device. Absent = never chosen. */
  language: 'bs.language',
  /** Rotating refresh token (Step 3 contract). The access token is never persisted. */
  refreshToken: 'bs.auth.refreshToken',
} as const;

export type StorageKey = (typeof storageKeys)[keyof typeof storageKeys];

export class SecureStorageError extends Error {
  constructor(
    public readonly operation: 'get' | 'set' | 'delete',
    public readonly key: StorageKey,
    options?: { cause?: unknown },
  ) {
    super(`Secure storage ${operation} failed for ${key}`, options);
    this.name = 'SecureStorageError';
  }
}

const nativeOptions: SecureStore.SecureStoreOptions = {
  // iOS: readable only while unlocked, never migrated to another device. Ignored on Android.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const nativeStore: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key, nativeOptions),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, nativeOptions),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, nativeOptions),
};

export function createMemoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    deleteItem: async (key) => {
      values.delete(key);
    },
  };
}

/** Normalises failures into SecureStorageError (no values in messages). */
export function withErrorHandling(store: KeyValueStore): KeyValueStore {
  return {
    async getItem(key) {
      try {
        return await store.getItem(key);
      } catch (cause) {
        // An unreadable entry (e.g. Android Keystore key lost after an OS restore) can never be read
        // again: remove it so the next start is clean, then report the failure.
        await store.deleteItem(key).catch(() => undefined);
        throw new SecureStorageError('get', key, { cause });
      }
    },
    async setItem(key, value) {
      try {
        await store.setItem(key, value);
      } catch (cause) {
        throw new SecureStorageError('set', key, { cause });
      }
    },
    async deleteItem(key) {
      try {
        await store.deleteItem(key);
      } catch (cause) {
        throw new SecureStorageError('delete', key, { cause });
      }
    },
  };
}

export const secureStorage: KeyValueStore = withErrorHandling(
  Platform.OS === 'web' ? createMemoryStore() : nativeStore,
);
