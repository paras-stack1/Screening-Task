import {
  addGuardianLinkRequestSchema,
  ageOn,
  maskIndianMobile,
  normalizeIndianMobile,
  parseCalendarDate,
  personNameSchema,
  registerChildRequestSchema,
  subtractYearsMonths,
  todayInIndia,
  updateChildRequestSchema,
  updateGuardianRequestSchema,
} from '@balswasthya/shared-contracts';
import { describe, expect, it } from 'vitest';
import { resolveBirthDate } from '../src/modules/children/birthDate';
import { editDistance, matchKey, namesLookSimilar } from '../src/modules/children/nameMatching';
import { createPiiCrypto } from '../src/utils/piiCrypto';

/** Step 5 pure rules: dates, names, phones, request schemas, phone encryption. Synthetic data only. */
const d = (value: string) => parseCalendarDate(value)!;
const NOW = new Date('2026-11-21T09:00:00.000Z');

describe('calendar dates (decision C)', () => {
  it.each(['2023-02-29', '2024-13-01', '2024-04-31', '2024-00-10', '24-01-01', '2024-1-1', '1899-12-31'])(
    'rejects impossible or malformed date %s',
    (value) => expect(parseCalendarDate(value)).toBeNull(),
  );

  it('accepts 29 February in a leap year only', () => {
    expect(parseCalendarDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseCalendarDate('2100-02-29')).toBeNull(); // century, not leap
    expect(parseCalendarDate('2000-02-29')).not.toBeNull(); // divisible by 400
  });

  it('uses the date in India, not UTC (01:00 IST is still the previous UTC day)', () => {
    expect(todayInIndia(new Date('2026-11-20T19:45:00.000Z'))).toEqual({ year: 2026, month: 11, day: 21 });
    expect(todayInIndia(new Date('2026-11-20T18:15:00.000Z'))).toEqual({ year: 2026, month: 11, day: 20 });
  });

  it('calculates age by calendar, not by subtracting years', () => {
    expect(ageOn(d('2020-11-22'), d('2026-11-21'))).toEqual({ years: 5, months: 11 });
    expect(ageOn(d('2020-11-21'), d('2026-11-21'))).toEqual({ years: 6, months: 0 });
    expect(ageOn(d('2026-01-31'), d('2026-02-28'))).toEqual({ years: 0, months: 1 });
    expect(ageOn(d('2024-02-29'), d('2025-02-28'))).toEqual({ years: 1, months: 0 });
    expect(ageOn(d('2024-02-29'), d('2025-02-27'))).toEqual({ years: 0, months: 11 });
  });

  it('subtracts years and months with end-of-month clamping', () => {
    expect(subtractYearsMonths(d('2026-03-31'), 0, 1)).toEqual(d('2026-02-28'));
    expect(subtractYearsMonths(d('2024-03-31'), 0, 1)).toEqual(d('2024-02-29'));
    expect(subtractYearsMonths(d('2026-01-15'), 2, 3)).toEqual(d('2023-10-15'));
  });
});

describe('resolveBirthDate (server-side rules)', () => {
  it('keeps an exact past date unchanged and not estimated', () => {
    const r = resolveBirthDate({ dateOfBirth: '2022-05-17' }, NOW);
    expect(r.isEstimated).toBe(false);
    expect(r.value.toISOString()).toBe('2022-05-17T00:00:00.000Z');
  });

  it('accepts today and rejects tomorrow (India date)', () => {
    expect(resolveBirthDate({ dateOfBirth: '2026-11-21' }, NOW).isEstimated).toBe(false);
    expect(() => resolveBirthDate({ dateOfBirth: '2026-11-22' }, NOW)).toThrow(
      expect.objectContaining({ statusCode: 422, code: 'DATE_OF_BIRTH_IN_FUTURE' }),
    );
    // 20:00 UTC on 21 Nov is already 22 Nov in India.
    expect(
      resolveBirthDate({ dateOfBirth: '2026-11-22' }, new Date('2026-11-21T20:00:00Z')).isEstimated,
    ).toBe(false);
  });

  it('rejects an impossible date instead of adjusting it', () => {
    expect(() => resolveBirthDate({ dateOfBirth: '2023-02-29' }, NOW)).toThrow(
      expect.objectContaining({ code: 'INVALID_DATE_OF_BIRTH' }),
    );
  });

  it('rejects children older than the programme limit (assumption: 18 completed years)', () => {
    expect(resolveBirthDate({ dateOfBirth: '2007-11-22' }, NOW).isEstimated).toBe(false); // 18y 11m
    expect(() => resolveBirthDate({ dateOfBirth: '2007-11-21' }, NOW)).toThrow(
      expect.objectContaining({ code: 'CHILD_AGE_OUT_OF_RANGE' }),
    );
  });

  it('derives an ESTIMATED date from an age estimate', () => {
    const r = resolveBirthDate({ ageEstimate: { years: 3, months: 6 } }, NOW);
    expect(r.isEstimated).toBe(true);
    expect(r.value.toISOString().slice(0, 10)).toBe('2023-05-21');
  });
});

describe('name matching for duplicate warnings (decision G)', () => {
  it('normalises case, spacing and punctuation, keeps Hindi marks', () => {
    expect(matchKey('  Priya   KUMARI. ')).toBe('priya kumari');
    expect(matchKey('सीता  देवी')).toBe('सीता देवी');
  });

  it.each([
    ['Priya Kumari', 'priya kumari'],
    ['Priya Kumari', 'Kumari Priya'],
    ['Priya Kumari', 'Priya Kumary'],
    ['Synthetic Asha', 'Synthetik Asha'],
    ['सीता देवी', 'सीता  देवी'],
  ])('%s ~ %s', (a, b) => expect(namesLookSimilar(a, b)).toBe(true));

  it.each([
    ['Priya Kumari', 'Pooja Sharma'],
    ['Ram', 'Raj'], // short names: exact only
    ['सीता देवी', 'गीता रानी'],
  ])('%s is not similar to %s', (a, b) => expect(namesLookSimilar(a, b)).toBe(false));

  it('edit distance stops early', () => {
    expect(editDistance('abcdef', 'abcxyz', 1)).toBe(2);
    expect(editDistance('kitten', 'sitting', 3)).toBe(3);
  });
});

describe('Indian mobile numbers (decision F)', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['91-98765-43210', '+919876543210'],
    ['(+91) 6000000000', '+916000000000'],
  ])('normalises %s', (input, expected) => expect(normalizeIndianMobile(input)).toBe(expected));

  it.each(['5876543210', '987654321', '98765432101', '+1 9876543210', 'abcdefghij', '+92 9876543210', ''])(
    'rejects %s',
    (input) => expect(normalizeIndianMobile(input)).toBeNull(),
  );

  it('masks all but the last four digits', () => {
    expect(maskIndianMobile('+919876543210')).toBe('+91 ••••••3210');
  });
});

describe('person names', () => {
  it('cleans whitespace and accepts Hindi and English letters', () => {
    expect(personNameSchema.parse('  Synthetic   Child ')).toBe('Synthetic Child');
    expect(personNameSchema.parse('सिंथेटिक बच्चा')).toBe('सिंथेटिक बच्चा');
    expect(personNameSchema.parse("D'Souza-Rao Jr.")).toBe("D'Souza-Rao Jr.");
  });

  it.each(['A', '', '   ', 'Child 123', '<script>', 'Robert"); DROP TABLE', 'x'.repeat(101)])(
    'rejects %s',
    (value) => expect(personNameSchema.safeParse(value).success).toBe(false),
  );
});

describe('request schemas (mass-assignment protection)', () => {
  const valid = {
    clientOperationId: '11111111-1111-4111-8111-111111111111',
    fullName: 'Synthetic Child',
    dateOfBirth: '2022-01-01',
    areaId: '22222222-2222-4222-8222-222222222222',
    guardians: [
      { newGuardian: { fullName: 'Synthetic Mother' }, relationship: 'MOTHER', canGiveConsent: true },
    ],
  };

  it('accepts a minimal registration and applies safe defaults', () => {
    const parsed = registerChildRequestSchema.parse(valid);
    expect(parsed.confirmNotDuplicate).toBe(false);
    expect(parsed.guardians[0]).toMatchObject({ isPrimaryContact: false, confirmNewGuardian: false });
    expect(parsed.guardians[0]!.newGuardian!.preferredLanguage).toBe('hi');
  });

  it.each([
    ['createdById', { createdById: '33333333-3333-4333-8333-333333333333' }],
    ['createdAt', { createdAt: '2020-01-01T00:00:00Z' }],
    ['deletedAt', { deletedAt: null }],
    ['dobIsEstimated', { dobIsEstimated: true }],
    ['status', { status: 'ACTIVE' }],
  ])('rejects protected field %s', (_name, extra) => {
    expect(registerChildRequestSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });

  it('requires exactly one of dateOfBirth / ageEstimate', () => {
    const { dateOfBirth: _omit, ...noDate } = valid;
    expect(registerChildRequestSchema.safeParse(noDate).success).toBe(false);
    expect(
      registerChildRequestSchema.safeParse({ ...valid, ageEstimate: { years: 2, months: 0 } }).success,
    ).toBe(false);
    expect(
      registerChildRequestSchema.safeParse({ ...noDate, ageEstimate: { years: 2, months: 3 } }).success,
    ).toBe(true);
  });

  it.each([
    ['no guardian', { guardians: [] }],
    ['five guardians', { guardians: Array(5).fill(valid.guardians[0]) }],
    [
      'two primary contacts',
      {
        guardians: [
          { ...valid.guardians[0], isPrimaryContact: true },
          { ...valid.guardians[0], isPrimaryContact: true },
        ],
      },
    ],
    [
      'consent authority not answered',
      { guardians: [{ newGuardian: { fullName: 'Synthetic M' }, relationship: 'MOTHER' }] },
    ],
    ['unknown relationship', { guardians: [{ ...valid.guardians[0], relationship: 'NEIGHBOUR' }] }],
    [
      'both existing and new guardian',
      { guardians: [{ ...valid.guardians[0], existingGuardianId: '44444444-4444-4444-8444-444444444444' }] },
    ],
    [
      'invalid phone',
      { guardians: [{ ...valid.guardians[0], newGuardian: { fullName: 'Synthetic M', phone: '12345' } }] },
    ],
    ['age estimate months 12', { dateOfBirth: undefined, ageEstimate: { years: 1, months: 12 } }],
    ['age estimate 19 years', { dateOfBirth: undefined, ageEstimate: { years: 19, months: 0 } }],
    ['unknown sex value', { sexAtBirth: 'X' }],
    ['non-uuid area', { areaId: "1' OR 1=1" }],
  ])('rejects %s', (_name, override) => {
    expect(registerChildRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('child update cannot change area, creator or status', () => {
    const base = { expectedUpdatedAt: '2026-11-21T09:00:00.000Z' };
    expect(updateChildRequestSchema.safeParse({ ...base, fullName: 'Synthetic New' }).success).toBe(true);
    for (const extra of [{ areaId: valid.areaId }, { createdById: valid.areaId }, { deletedAt: null }]) {
      expect(updateChildRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(updateChildRequestSchema.safeParse(base).success).toBe(false); // nothing to update
    expect(updateChildRequestSchema.safeParse({ fullName: 'Synthetic New' }).success).toBe(false); // no version
  });

  it('guardian update cannot set lookup hash or deletion; phone null removes', () => {
    const base = { expectedUpdatedAt: '2026-11-21T09:00:00.000Z' };
    expect(updateGuardianRequestSchema.parse({ ...base, phone: null }).phone).toBeNull();
    expect(updateGuardianRequestSchema.safeParse({ ...base, phoneLookupHash: 'x' }).success).toBe(false);
    expect(updateGuardianRequestSchema.safeParse({ ...base, deletedAt: null }).success).toBe(false);
  });

  it('add-link request requires a submission id', () => {
    const link = {
      existingGuardianId: '44444444-4444-4444-8444-444444444444',
      relationship: 'FATHER',
      canGiveConsent: false,
    };
    expect(addGuardianLinkRequestSchema.safeParse(link).success).toBe(false);
    expect(
      addGuardianLinkRequestSchema.safeParse({ ...link, clientOperationId: valid.clientOperationId }).success,
    ).toBe(true);
  });
});

describe('phone encryption (decision D5)', () => {
  const pii = createPiiCrypto({ encryptionKey: Buffer.alloc(32, 7), lookupKey: Buffer.alloc(32, 9) });
  const guardianA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const guardianB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('round-trips, with a random IV (same number -> different ciphertext)', () => {
    const one = pii.encryptPhone('+919876543210', guardianA);
    const two = pii.encryptPhone('+919876543210', guardianA);
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(false);
    expect(Buffer.from(one).toString('utf8')).not.toContain('9876543210');
    expect(pii.decryptPhone(one, guardianA)).toBe('+919876543210');
  });

  it('ciphertext bound to its guardian: copying it to another guardian fails', () => {
    const stored = pii.encryptPhone('+919876543210', guardianA);
    expect(() => pii.decryptPhone(stored, guardianB)).toThrow();
  });

  it('detects tampering', () => {
    const stored = pii.encryptPhone('+919876543210', guardianA);
    stored[stored.length - 1] = stored[stored.length - 1]! ^ 1;
    expect(() => pii.decryptPhone(stored, guardianA)).toThrow();
  });

  it('lookup hash is keyed and deterministic', () => {
    const other = createPiiCrypto({ encryptionKey: Buffer.alloc(32, 7), lookupKey: Buffer.alloc(32, 8) });
    expect(pii.phoneLookupHash('+919876543210')).toBe(pii.phoneLookupHash('+919876543210'));
    expect(pii.phoneLookupHash('+919876543210')).not.toBe(other.phoneLookupHash('+919876543210'));
    expect(pii.phoneLookupHash('+919876543210')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('without keys, refuses to store numbers (503) instead of storing them unprotected', () => {
    const none = createPiiCrypto({});
    expect(none.available).toBe(false);
    expect(() => none.encryptPhone('+919876543210', guardianA)).toThrow(
      expect.objectContaining({ statusCode: 503, code: 'PHONE_STORAGE_UNAVAILABLE' }),
    );
  });
});
