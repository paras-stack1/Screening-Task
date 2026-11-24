import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isApiError } from '../api/http';
import { useServices } from '../services';
import { LANGUAGE_KEY } from '../storage';
import { en, type TranslationKey } from './en';
import { hi } from './hi';

export type { TranslationKey } from './en';
export type Language = 'hi' | 'en';
export type TranslationParams = Record<string, string | number>;
export const translations: Record<Language, Record<TranslationKey, string>> = { en, hi };

const PLACEHOLDER = /\{\{(\w+)\}\}/g;
export function translate(language: Language, key: TranslationKey, params?: TranslationParams): string {
  const text = translations[language][key] || en[key] || key;
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

interface I18n {
  language: Language;
  setLanguage(language: Language): void;
  t(key: TranslationKey, params?: TranslationParams): string;
}

const I18nContext = createContext<I18n | null>(null);

/** Hindi by default (PP1, Hindi-friendly); the choice is remembered on this device. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { store } = useServices();
  const [language, setLanguageState] = useState<Language>('hi');
  useEffect(() => {
    store
      .get(LANGUAGE_KEY)
      .then((saved) => {
        if (saved === 'hi' || saved === 'en') setLanguageState(saved);
      })
      .catch(() => undefined);
  }, [store]);
  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      store.set(LANGUAGE_KEY, next).catch(() => undefined);
    },
    [store],
  );
  const value = useMemo<I18n>(
    () => ({ language, setLanguage, t: (key, params) => translate(language, key, params) }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}

/** A translated message for any failed call (no server text is ever shown). */
export function errorKey(
  error: unknown,
  byCode: Partial<Record<string, TranslationKey>> = {},
): TranslationKey {
  if (!isApiError(error)) return 'errors.generic';
  if (error.code && byCode[error.code]) return byCode[error.code]!;
  if (error.kind === 'network') return 'errors.network';
  if (error.kind === 'timeout') return 'errors.timeout';
  if (error.kind === 'notConfigured') return 'errors.notConfigured';
  if (error.code === 'SMS_NOT_CONFIGURED' || error.code === 'SMS_NOT_SENT') return 'errors.smsNotConfigured';
  if (error.code === 'OTP_NOT_CONFIGURED') return 'errors.otpNotConfigured';
  if (error.status === 429) return 'errors.tooMany';
  if ((error.status ?? 0) >= 500) return 'errors.server';
  return 'errors.generic';
}
