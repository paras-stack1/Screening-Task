import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@balswasthya/shared-contracts';
import { en, type TranslationKey } from './en';
import { hi } from './hi';

export type { TranslationKey } from './en';
export type TranslationParams = Record<string, string | number>;
export type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;

export const translations: Record<SupportedLanguage, Record<TranslationKey, string>> = { en, hi };

export const DEFAULT_LANGUAGE: SupportedLanguage = 'hi';

/** Shown in the language's own script so each is recognisable whatever the current language. */
export const LANGUAGE_OPTIONS: readonly { value: SupportedLanguage; nativeName: string }[] = [
  { value: 'hi', nativeName: 'हिंदी' },
  { value: 'en', nativeName: 'English' },
];

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function isTranslationKey(value: unknown): value is TranslationKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(en, value);
}

export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '').sort();
}

/** Replaces `{{name}}`. A missing parameter is left visible rather than silently dropped. */
export function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** Falls back to English, then to the key itself, so a gap never crashes a screen. */
export function translate(
  language: SupportedLanguage,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const text = translations[language][key] || translations.en[key] || key;
  return interpolate(text, params);
}
