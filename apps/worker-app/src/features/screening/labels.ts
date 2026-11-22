import type { FourDCategoryCode, LocalizedText } from '@balswasthya/shared-contracts';
import type { TranslationKey } from '../../localization';
import type { FourDCategory } from '../../theme';

/** API category code -> theme identity (icon + colour) and the existing reviewed 4-D labels. */
export const CATEGORY_THEME: Record<FourDCategoryCode, FourDCategory> = {
  DEFECTS_AT_BIRTH: 'defectsAtBirth',
  DEFICIENCIES: 'deficiencies',
  DISEASES: 'diseases',
  DEVELOPMENTAL_DELAYS_DISABILITIES: 'developmentalDelays',
};

export function categoryTitleKey(category: FourDCategoryCode): TranslationKey {
  return `fourD.${CATEGORY_THEME[category]}.title` as TranslationKey;
}

export function categoryDescriptionKey(category: FourDCategoryCode): TranslationKey {
  return `fourD.${CATEGORY_THEME[category]}.description` as TranslationKey;
}

/** Protocol wording in the worker's language (both are always present and validated). */
export function localized(text: LocalizedText, language: string): string {
  return language === 'en' ? text.en : text.hi;
}

export const MEASUREMENT_TYPE_KEYS = {
  WEIGHT: 'screening.measurement.type.WEIGHT',
  HEIGHT: 'screening.measurement.type.HEIGHT',
  LENGTH: 'screening.measurement.type.LENGTH',
  MUAC: 'screening.measurement.type.MUAC',
  HEAD_CIRCUMFERENCE: 'screening.measurement.type.HEAD_CIRCUMFERENCE',
} as const satisfies Record<string, TranslationKey>;

export const MEASUREMENT_SOURCE_KEYS = {
  MEASURED: 'screening.measurement.source.MEASURED',
  GUARDIAN_REPORTED: 'screening.measurement.source.GUARDIAN_REPORTED',
  FROM_RECORD: 'screening.measurement.source.FROM_RECORD',
} as const satisfies Record<string, TranslationKey>;

export const MEASUREMENT_QUALITY_KEYS = {
  RELIABLE: 'screening.measurement.quality.RELIABLE',
  QUESTIONABLE: 'screening.measurement.quality.QUESTIONABLE',
  NOT_RELIABLE: 'screening.measurement.quality.NOT_RELIABLE',
} as const satisfies Record<string, TranslationKey>;
