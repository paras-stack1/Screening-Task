import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { LanguageProvider, useTranslation } from '../../src/localization';
import { createMemoryStore, storageKeys, type KeyValueStore } from '../../src/services/storage/secureStorage';

function setup(store: KeyValueStore, initialLanguage: 'hi' | 'en' = 'hi') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LanguageProvider store={store} initialLanguage={initialLanguage}>
      {children}
    </LanguageProvider>
  );
  return renderHook(() => useTranslation(), { wrapper });
}

/** A store whose read can be resolved by the test at a chosen moment. */
function deferredStore(base = createMemoryStore()) {
  let resolveRead: (value: string | null) => void = () => undefined;
  const store: KeyValueStore = {
    ...base,
    getItem: () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  };
  return { store, resolveRead: (value: string | null) => resolveRead(value) };
}

describe('LanguageProvider', () => {
  it('starts with the initial language and becomes ready after reading storage', async () => {
    const { result } = await setup(createMemoryStore(), 'hi');
    expect(result.current.language).toBe('hi');
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.t('common.retry')).toBe('फिर से कोशिश करें');
  });

  it('restores a language saved on this device', async () => {
    const store = createMemoryStore();
    await store.setItem(storageKeys.language, 'en');
    const { result } = await setup(store, 'hi');
    await waitFor(() => expect(result.current.language).toBe('en'));
  });

  it('ignores an invalid saved value', async () => {
    const store = createMemoryStore();
    await store.setItem(storageKeys.language, 'xx');
    const { result } = await setup(store, 'hi');
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.language).toBe('hi');
  });

  it('saves an explicit choice', async () => {
    const store = createMemoryStore();
    const { result } = await setup(store, 'hi');
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await act(async () => result.current.setLanguage('en'));
    expect(result.current.language).toBe('en');
    expect(await store.getItem(storageKeys.language)).toBe('en');
  });

  it('keeps working when storage cannot be read or written', async () => {
    const broken: KeyValueStore = {
      getItem: () => Promise.reject(new Error('keystore unavailable')),
      setItem: () => Promise.reject(new Error('keystore unavailable')),
      deleteItem: () => Promise.reject(new Error('keystore unavailable')),
    };
    const { result } = await setup(broken, 'hi');
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await act(async () => result.current.setLanguage('en'));
    expect(result.current.language).toBe('en');
  });

  it('applies the account language only when the user never chose one (decision G)', async () => {
    const { result } = await setup(createMemoryStore(), 'hi');
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await act(async () => result.current.applyAccountLanguage('en'));
    expect(result.current.language).toBe('en');
  });

  it('does not let the account language override a saved device choice', async () => {
    const store = createMemoryStore();
    await store.setItem(storageKeys.language, 'hi');
    const { result } = await setup(store, 'en');
    await waitFor(() => expect(result.current.language).toBe('hi'));
    await act(async () => result.current.applyAccountLanguage('en'));
    expect(result.current.language).toBe('hi');
  });

  it('ignores an unsupported account language', async () => {
    const { result } = await setup(createMemoryStore(), 'hi');
    await act(async () => result.current.applyAccountLanguage('ta'));
    expect(result.current.language).toBe('hi');
  });

  it('a choice made while storage is still loading wins over the stored value', async () => {
    const { store, resolveRead } = deferredStore();
    const { result } = await setup(store, 'hi');
    await act(async () => result.current.setLanguage('en'));
    await act(async () => resolveRead('hi'));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.language).toBe('en');
  });

  it('useTranslation throws outside the provider', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useTranslation())).rejects.toThrow('inside <LanguageProvider>');
  });
});
