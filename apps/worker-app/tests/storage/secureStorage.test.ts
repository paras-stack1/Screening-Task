import * as SecureStore from 'expo-secure-store';
import {
  createMemoryStore,
  secureStorage,
  SecureStorageError,
  storageKeys,
  withErrorHandling,
  type KeyValueStore,
} from '../../src/services/storage/secureStorage';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mocked = jest.mocked(SecureStore);
const SECRET = 'super-secret-token-value';

describe('secureStorage (native)', () => {
  it('uses SecureStore with device-only keychain access', async () => {
    mocked.getItemAsync.mockResolvedValue('hi');
    await expect(secureStorage.getItem(storageKeys.language)).resolves.toBe('hi');
    expect(mocked.getItemAsync).toHaveBeenCalledWith('bs.language', { keychainAccessible: 6 });

    mocked.setItemAsync.mockResolvedValue(undefined);
    await secureStorage.setItem(storageKeys.refreshToken, SECRET);
    expect(mocked.setItemAsync).toHaveBeenCalledWith('bs.auth.refreshToken', SECRET, {
      keychainAccessible: 6,
    });
  });

  it('all keys are valid SecureStore keys', () => {
    for (const key of Object.values(storageKeys)) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('withErrorHandling', () => {
  function failing(overrides: Partial<KeyValueStore>): KeyValueStore {
    return { ...createMemoryStore(), ...overrides };
  }

  it('wraps a write failure without exposing the value', async () => {
    const store = withErrorHandling(failing({ setItem: () => Promise.reject(new Error(`boom ${SECRET}`)) }));
    const error = await store.setItem(storageKeys.refreshToken, SECRET).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecureStorageError);
    expect((error as Error).message).not.toContain(SECRET);
    expect((error as SecureStorageError).operation).toBe('set');
  });

  it('removes an unreadable entry and reports the failure', async () => {
    const deleteItem = jest.fn(() => Promise.resolve());
    const store = withErrorHandling(
      failing({ getItem: () => Promise.reject(new Error('key lost')), deleteItem }),
    );
    await expect(store.getItem(storageKeys.refreshToken)).rejects.toBeInstanceOf(SecureStorageError);
    expect(deleteItem).toHaveBeenCalledWith(storageKeys.refreshToken);
  });

  it('still reports the read failure if the cleanup also fails', async () => {
    const store = withErrorHandling(
      failing({
        getItem: () => Promise.reject(new Error('key lost')),
        deleteItem: () => Promise.reject(new Error('also broken')),
      }),
    );
    await expect(store.getItem(storageKeys.language)).rejects.toMatchObject({ operation: 'get' });
  });

  it('wraps delete failures', async () => {
    const store = withErrorHandling(failing({ deleteItem: () => Promise.reject(new Error('x')) }));
    await expect(store.deleteItem(storageKeys.language)).rejects.toMatchObject({ operation: 'delete' });
  });
});

describe('createMemoryStore', () => {
  it('stores, reads and deletes', async () => {
    const store = createMemoryStore();
    expect(await store.getItem(storageKeys.language)).toBeNull();
    await store.setItem(storageKeys.language, 'en');
    expect(await store.getItem(storageKeys.language)).toBe('en');
    await store.deleteItem(storageKeys.language);
    expect(await store.getItem(storageKeys.language)).toBeNull();
  });
});
