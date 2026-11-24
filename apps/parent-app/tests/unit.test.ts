import { resolveApiBaseUrl } from '../src/config';
import { en, type TranslationKey } from '../src/i18n/en';
import { hi } from '../src/i18n/hi';

jest.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 }));

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
/** Keys that are the same in both languages by design. */
const SAME_IN_BOTH = new Set<TranslationKey>(['common.language']);

describe('translations', () => {
  const keys = Object.keys(en) as TranslationKey[];
  it.each(keys)('%s has a Hindi text with the same placeholders', (key) => {
    expect(hi[key]).toBeTruthy();
    expect(placeholders(hi[key])).toEqual(placeholders(en[key]));
  });
  it.each(keys.filter((k) => !SAME_IN_BOTH.has(k)))('%s is actually Hindi (Devanagari)', (key) => {
    expect(hi[key]).toMatch(/[ऀ-ॿ]/);
  });
});

describe('API address', () => {
  it('requires https outside development and rejects credentials or query strings', () => {
    expect(resolveApiBaseUrl('http://api.example.in/api/v1', false)).toEqual({
      ok: false,
      problem: 'insecure',
    });
    expect(resolveApiBaseUrl('https://api.example.in/api/v1/', false)).toEqual({
      ok: true,
      url: 'https://api.example.in/api/v1',
    });
    expect(resolveApiBaseUrl('https://u:p@api.example.in', false)).toEqual({ ok: false, problem: 'invalid' });
    expect(resolveApiBaseUrl(undefined, false)).toEqual({ ok: false, problem: 'missing' });
    expect(resolveApiBaseUrl(undefined, true)).toMatchObject({ ok: true });
  });
});
