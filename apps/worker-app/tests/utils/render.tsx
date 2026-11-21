import type { SupportedLanguage } from '@balswasthya/shared-contracts';
import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../../src/localization';
import { createMemoryStore, type KeyValueStore } from '../../src/services/storage/secureStorage';

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 760 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

interface ProviderOptions {
  language?: SupportedLanguage;
  store?: KeyValueStore;
}

export function TestProviders({
  children,
  language = 'en',
  store,
}: ProviderOptions & { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <LanguageProvider initialLanguage={language} store={store ?? createMemoryStore()}>
        {children}
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

/** Renders with the app's providers. Defaults to English and a fresh in-memory store. */
export function renderWithProviders(ui: ReactElement, options: ProviderOptions & RenderOptions = {}) {
  const { language, store, ...renderOptions } = options;
  return render(
    <TestProviders language={language} store={store}>
      {ui}
    </TestProviders>,
    renderOptions,
  );
}

/** Flattened style of a rendered element, for layout assertions such as touch-target size. */
export function flatStyle(element: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(element.props.style as never) ?? {}) as Record<string, unknown>;
}
