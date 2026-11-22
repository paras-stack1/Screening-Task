import { en } from '../../src/localization/en';
import { hi } from '../../src/localization/hi';
import {
  interpolate,
  isSupportedLanguage,
  placeholdersOf,
  translate,
  type TranslationKey,
} from '../../src/localization/translate';

const keys = Object.keys(en) as TranslationKey[];
const DEVANAGARI = /[ऀ-ॿ]/;
/** Keys whose Hindi value legitimately contains no Devanagari (placeholders only). */
const NO_DEVANAGARI_EXPECTED = new Set<TranslationKey>([
  'metric.a11y.value',
  'profile.areaWithLevel',
  'consent.record.confirmMessage',
  'consent.record.savedLine',
]);

describe('translation files', () => {
  it('Hindi has exactly the English keys', () => {
    expect(Object.keys(hi).sort()).toEqual([...keys].sort());
  });

  it.each(keys)('%s is non-empty and trimmed in both languages', (key) => {
    for (const text of [en[key], hi[key]]) {
      expect(text.trim()).not.toBe('');
      expect(text).toBe(text.trim());
    }
  });

  it.each(keys)('%s uses the same placeholders in both languages', (key) => {
    expect(placeholdersOf(hi[key])).toEqual(placeholdersOf(en[key]));
  });

  it.each(keys.filter((key) => !NO_DEVANAGARI_EXPECTED.has(key)))(
    '%s is actually translated into Hindi (contains Devanagari)',
    (key) => {
      expect(hi[key]).toMatch(DEVANAGARI);
    },
  );

  it('keys follow the dotted naming convention', () => {
    // Segments may contain '_' because some mirror server codes (role.STATE_ADMIN, AREA_ONLY).
    for (const key of keys) expect(key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/);
  });
});

describe('translate()', () => {
  it('returns the requested language', () => {
    expect(translate('hi', 'common.retry')).toBe('फिर से कोशिश करें');
    expect(translate('en', 'common.retry')).toBe('Try again');
  });

  it('interpolates parameters, including numbers', () => {
    expect(translate('en', 'metric.a11y.value', { label: 'Children', value: 12 })).toBe('Children: 12');
    expect(translate('hi', 'metric.a11y.unavailable', { label: 'बच्चे' })).toBe('बच्चे: अभी उपलब्ध नहीं');
  });

  it('leaves a missing parameter visible instead of dropping it', () => {
    expect(interpolate('Hello {{name}}', {})).toBe('Hello {{name}}');
  });

  it('does not interpret special replacement patterns in values', () => {
    expect(interpolate('Hi {{name}}', { name: '$& $1' })).toBe('Hi $& $1');
  });

  it('falls back to English and then to the key for an unknown key', () => {
    expect(translate('hi', 'missing.key' as TranslationKey)).toBe('missing.key');
  });
});

describe('isSupportedLanguage()', () => {
  it.each([
    ['hi', true],
    ['en', true],
    ['ta', false],
    ['', false],
    [null, false],
    [42, false],
  ])('%p -> %p', (value, expected) => {
    expect(isSupportedLanguage(value)).toBe(expected);
  });
});
