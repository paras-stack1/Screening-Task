import { translate, type TranslationKey, type TranslationParams } from '../../src/localization';
import { birthText, formatCalendarDate, formatIndiaDate } from '../../src/features/children/labels';
import {
  createRegistrationSchema,
  datePartsToIso,
  emptyRegistration,
  toRegisterRequest,
  type RegistrationFormValues,
} from '../../src/features/children/validation';
import { childRoutes } from '../../src/features/children/routes';
import { newSubmissionId } from '../../src/utils/submissionId';

/** Step 5D pure rules: dates, ages, request building, submission ids, safe links. Synthetic data. */
const t = (key: TranslationKey, params?: TranslationParams) => translate('en', key, params);
const NOW = new Date('2026-11-21T09:00:00.000Z');

const valid: RegistrationFormValues = {
  ...emptyRegistration,
  fullName: '  Synthetic   Child ',
  dobMode: 'exact',
  day: '7',
  month: '3',
  year: '2023',
  areaId: '0a0a0a0a-0000-4000-8000-00000000a001',
  guardianName: 'Synthetic Mother',
  relationship: 'MOTHER',
  canGiveConsent: 'no',
};

function errorsOf(values: RegistrationFormValues, now = NOW) {
  const result = createRegistrationSchema(() => now).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('date boxes', () => {
  it.each([
    [['7', '3', '2023'], '2023-03-07'],
    [['29', '2', '2024'], '2024-02-29'],
    [['29', '2', '2023'], null],
    [['31', '4', '2024'], null],
    [['1', '13', '2024'], null],
    [['1', '1', '24'], null],
    [['a', '1', '2024'], null],
  ])('%j -> %s', ([d, m, y], expected) => expect(datePartsToIso(d!, m!, y!)).toBe(expected));
});

describe('registration form rules (client side, the API re-checks)', () => {
  it('a complete form is valid', () => {
    expect(errorsOf(valid)).toEqual({});
  });

  it('uses the India date for "today" (a date that is already today in India is not "future")', () => {
    const late = new Date('2026-11-21T20:00:00.000Z'); // 01:30 on 22 Nov in India
    expect(errorsOf({ ...valid, day: '22', month: '11', year: '2026' }, late)).toEqual({});
    expect(errorsOf({ ...valid, day: '22', month: '11', year: '2026' })).toEqual({
      day: 'children.form.errors.dobFuture',
    });
  });

  it('age estimate: years 0-18 and months 0-11', () => {
    const estimate = { ...valid, dobMode: 'estimate' as const, day: '', month: '', year: '' };
    expect(errorsOf({ ...estimate, ageYears: '4', ageMonths: '' })).toEqual({});
    expect(errorsOf({ ...estimate, ageYears: '19' })).toHaveProperty('ageYears');
    expect(errorsOf({ ...estimate, ageYears: '2', ageMonths: '12' })).toHaveProperty('ageMonths');
    expect(errorsOf({ ...estimate, ageYears: '' })).toHaveProperty('ageYears');
  });

  it('existing guardian needs a choice but no new-guardian details', () => {
    const existing = { ...valid, guardianSource: 'existing' as const, guardianName: '' };
    expect(errorsOf(existing)).toEqual({ existingGuardianId: 'children.form.errors.guardianChoiceRequired' });
    expect(errorsOf({ ...existing, existingGuardianId: 'g-1' })).toEqual({});
  });
});

describe('request building', () => {
  it('sends only programme fields; unknown sex and empty phone are omitted', () => {
    const request = toRegisterRequest(valid, 'op-1', {
      confirmNotDuplicate: false,
      confirmNewGuardian: false,
    });
    expect(request).toEqual({
      clientOperationId: 'op-1',
      fullName: '  Synthetic   Child ',
      dateOfBirth: '2023-03-07',
      areaId: valid.areaId,
      confirmNotDuplicate: false,
      guardians: [
        {
          newGuardian: { fullName: 'Synthetic Mother', preferredLanguage: 'hi' },
          relationship: 'MOTHER',
          isPrimaryContact: true,
          canGiveConsent: false,
          confirmNewGuardian: false,
        },
      ],
    });
  });

  it('an existing guardian is sent by id only', () => {
    const request = toRegisterRequest(
      { ...valid, guardianSource: 'existing', existingGuardianId: 'g-1', guardianPhone: '9876543210' },
      'op-2',
      { confirmNotDuplicate: true, confirmNewGuardian: false },
    );
    expect(request.guardians[0]).toEqual({
      existingGuardianId: 'g-1',
      relationship: 'MOTHER',
      isPrimaryContact: true,
      canGiveConsent: false,
    });
    expect(request.confirmNotDuplicate).toBe(true);
  });
});

describe('display', () => {
  it('exact dates in DD/MM/YYYY with calendar age; estimated dates never shown as a date', () => {
    expect(formatCalendarDate('2023-03-07')).toBe('07/03/2023');
    expect(birthText(t, { dateOfBirth: '2023-03-07', dobIsEstimated: false }, NOW)).toBe(
      'Born 07/03/2023 (3 years 8 months)',
    );
    const estimated = birthText(t, { dateOfBirth: '2023-03-07', dobIsEstimated: true }, NOW);
    expect(estimated).toBe('About 3 years 8 months old (date of birth not known)');
    expect(estimated).not.toContain('2023');
    expect(birthText(t, { dateOfBirth: '2026-06-01', dobIsEstimated: false }, NOW)).toBe(
      'Born 01/06/2026 (5 months)',
    );
  });

  it('registration time is shown as the India calendar date', () => {
    expect(formatIndiaDate('2026-11-21T19:00:00.000Z')).toBe('22/11/2026');
  });
});

describe('submission ids and links', () => {
  it('submission ids are RFC 4122 v4 and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, newSubmissionId));
    expect(ids.size).toBe(200);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('falls back safely when platform crypto is missing', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(newSubmissionId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });

  it('links contain only encoded ids', () => {
    expect(childRoutes.profile('abc/../x')).toBe('/children/abc%2F..%2Fx');
    expect(childRoutes.link('c-1', 'l-1')).toBe('/children/c-1/link/l-1');
    expect(childRoutes.register('c 1')).toBe('/children/register?siblingOf=c%201');
  });
});
