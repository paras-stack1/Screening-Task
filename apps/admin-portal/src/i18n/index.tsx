import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isApiError } from '../api/errors';
import { en, type TranslationKey } from './en';
import { hi } from './hi';

export type { TranslationKey } from './en';
export type Language = 'en' | 'hi';
export type TranslationParams = Record<string, string | number>;
export type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;

export const translations: Record<Language, Record<TranslationKey, string>> = { en, hi };
export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_OPTIONS: readonly { value: Language; nativeName: string }[] = [
  { value: 'en', nativeName: 'English' },
  { value: 'hi', nativeName: 'हिंदी' },
];

/** Only the chosen language is remembered in this browser (a convenience, never required). */
const STORAGE_KEY = 'balswasthya-admin-language';
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'hi';
}

export function isTranslationKey(value: string): value is TranslationKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}

export function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

export function translate(language: Language, key: TranslationKey, params?: TranslationParams): string {
  return interpolate(translations[language][key] ?? en[key], params);
}

function readStoredLanguage(): Language | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function storeLanguage(language: Language) {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage blocked: the choice simply is not remembered.
  }
}

interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Language }) {
  const [language, setLanguageState] = useState<Language>(
    () => initial ?? readStoredLanguage() ?? DEFAULT_LANGUAGE,
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ language, setLanguage, t: (key, params) => translate(language, key, params) }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

/**
 * Maps any failure to a translated, user-safe message. Server messages are never shown: they
 * may be English-only, technical or (in a bug) sensitive.
 */
export function errorMessageKey(error: unknown): TranslationKey {
  if (!isApiError(error)) return 'errors.unexpected';
  switch (error.kind) {
    case 'network':
      return 'errors.network';
    case 'timeout':
      return 'errors.timeout';
    case 'notConfigured':
      return 'errors.notConfigured';
    case 'noSession':
      return 'errors.sessionEnded';
    case 'invalidResponse':
      return 'errors.server';
    case 'cancelled':
      return 'errors.unexpected';
    case 'http':
      if (error.status === 429) return 'errors.tooManyRequests';
      if (error.status === 401) return 'errors.sessionEnded';
      if (error.status === 403) return 'errors.forbidden';
      if ((error.status ?? 0) >= 500) return 'errors.server';
      return 'errors.unexpected';
  }
}
