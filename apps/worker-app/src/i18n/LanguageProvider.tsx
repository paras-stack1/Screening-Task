import { getLocales } from 'expo-localization';
import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import type { SupportedLanguage } from '@balswasthya/shared-contracts';
import { translations, type TranslationKey } from './translations';

interface LanguageContextValue {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
  t: (key: TranslationKey) => string;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Default to Hindi when the device language is Hindi, otherwise English. */
function detectDeviceLanguage(): SupportedLanguage {
  const code = getLocales()[0]?.languageCode;
  return code === 'hi' ? 'hi' : 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<SupportedLanguage>(detectDeviceLanguage);

  const t = useCallback((key: TranslationKey) => translations[language][key], [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
