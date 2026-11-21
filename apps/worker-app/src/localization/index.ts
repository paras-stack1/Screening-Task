import { useContext } from 'react';
import { LanguageContext, type LanguageContextValue } from './LanguageProvider';

export { LanguageProvider, detectDeviceLanguage, type LanguageContextValue } from './LanguageProvider';
export {
  DEFAULT_LANGUAGE,
  LANGUAGE_OPTIONS,
  interpolate,
  isSupportedLanguage,
  isTranslationKey,
  translate,
  type TranslateFn,
  type TranslationKey,
  type TranslationParams,
} from './translate';

export function useTranslation(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used inside <LanguageProvider>');
  }
  return context;
}
