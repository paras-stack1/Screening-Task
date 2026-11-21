import type { SupportedLanguage } from '@balswasthya/shared-contracts';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { secureStorage, storageKeys, type KeyValueStore } from '../services/storage/secureStorage';
import { DEFAULT_LANGUAGE, isSupportedLanguage, translate, type TranslateFn } from './translate';

export interface LanguageContextValue {
  language: SupportedLanguage;
  /** False until the saved choice has been read, so screens can avoid a flash of the wrong language. */
  isReady: boolean;
  /** Explicit user choice: applied and saved on this device. */
  setLanguage: (language: SupportedLanguage) => void;
  /**
   * Account preference from the server (decision G). Applied only when the user has never chosen
   * a language on this device. Unsupported codes are ignored.
   */
  applyAccountLanguage: (language: string) => void;
  t: TranslateFn;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Hindi-first: Hindi unless the device is set to English. */
export function detectDeviceLanguage(): SupportedLanguage {
  const code = getLocales()[0]?.languageCode;
  return code === 'en' ? 'en' : DEFAULT_LANGUAGE;
}

interface LanguageProviderProps {
  children: ReactNode;
  /** Injectable for tests. */
  store?: KeyValueStore;
  initialLanguage?: SupportedLanguage;
}

export function LanguageProvider({
  children,
  store = secureStorage,
  initialLanguage,
}: LanguageProviderProps) {
  const [language, setLanguageState] = useState<SupportedLanguage>(
    () => initialLanguage ?? detectDeviceLanguage(),
  );
  const [isReady, setIsReady] = useState(false);
  /** Whether a language was chosen on this device (persisted, or chosen during this run). */
  const userChoseRef = useRef(false);

  useEffect(() => {
    let active = true;
    store
      .getItem(storageKeys.language)
      .then((saved) => {
        // A choice made while the read was in flight wins over the stored value.
        if (!active || userChoseRef.current) return;
        if (isSupportedLanguage(saved)) {
          userChoseRef.current = true;
          setLanguageState(saved);
        }
      })
      // Unreadable storage is not fatal: keep the device language.
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsReady(true);
      });
    return () => {
      active = false;
    };
  }, [store]);

  const setLanguage = useCallback(
    (next: SupportedLanguage) => {
      userChoseRef.current = true;
      setLanguageState(next);
      // Best effort: if saving fails the choice still applies for this run.
      store.setItem(storageKeys.language, next).catch(() => undefined);
    },
    [store],
  );

  const applyAccountLanguage = useCallback((preferred: string) => {
    if (!userChoseRef.current && isSupportedLanguage(preferred)) {
      setLanguageState(preferred);
    }
  }, []);

  const t = useCallback<TranslateFn>((key, params) => translate(language, key, params), [language]);

  const value = useMemo(
    () => ({ language, isReady, setLanguage, applyAccountLanguage, t }),
    [language, isReady, setLanguage, applyAccountLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
