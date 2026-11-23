import type { Language, TranslateFn } from '../../i18n';
import { isTranslationKey } from '../../i18n';

/** Dates and times are shown in India time, whatever the computer's time zone. */
export function formatDateTime(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function formatDate(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/** Role name: the portal's own label when it has one, otherwise the name sent by the API. */
export function roleLabel(
  t: TranslateFn,
  code: string,
  fallback?: { nameEn: string; nameHi: string },
  language: Language = 'en',
): string {
  const key = `role.${code}`;
  if (isTranslationKey(key)) return t(key);
  if (fallback) return language === 'hi' ? fallback.nameHi : fallback.nameEn;
  return code;
}

export function areaLabel(language: Language, nameEn: string, nameHi: string | null): string {
  return language === 'hi' && nameHi ? nameHi : nameEn;
}
