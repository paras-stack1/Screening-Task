import {
  addMeasurementRequestSchema,
  saveResponsesRequestSchema,
  startScreeningRequestSchema,
  updateCategoryRequestSchema,
} from '@balswasthya/shared-contracts';
import type { ScreeningObservation, ScreeningQuestion } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  convertDecimal,
  MEASUREMENT_RULES_VERSION,
  toDisplayUnit,
  validateMeasurement,
} from '../src/modules/screening/measurementRules';
import { responseColumns, responseValue } from '../src/modules/screening/responseRules';
import { completeness } from '../src/modules/screening/sessionDto';

/** Step 6, stage 6C: pure rules for answers, measurements, completeness and request schemas. */

const NOW = new Date('2026-11-22T06:00:00Z');
const BIRTH = new Date('2024-01-01T00:00:00+05:30');

function check(input: Partial<Parameters<typeof validateMeasurement>[0]>) {
  return () =>
    validateMeasurement({
      type: 'WEIGHT',
      value: '10.5',
      unit: 'kg',
      measuredAt: NOW,
      now: NOW,
      notBefore: BIRTH,
      ...input,
    });
}

describe('measurement unit conversion (exact, explicit)', () => {
  it.each([
    ['3250', 'g', 'kg', '3.25'],
    ['2.5', 'kg', 'g', '2500'],
    ['0.05', 'kg', 'g', '50'],
    ['125', 'mm', 'cm', '12.5'],
    ['0.5', 'cm', 'mm', '5'],
    ['12.30', 'cm', 'cm', '12.3'],
    ['1', 'g', 'kg', '0.001'],
  ] as const)('%s %s = %s %s', (value, from, to, expected) => {
    expect(convertDecimal(value, from, to)).toBe(expected);
  });

  it('never converts across dimensions', () => {
    expect(() => convertDecimal('1', 'kg', 'cm')).toThrow(/Cannot convert/);
  });

  it('displays weight in kg and lengths in cm, keeping the entered value', () => {
    expect(toDisplayUnit('WEIGHT', '3250', 'g')).toEqual({ value: '3.25', unit: 'kg' });
    expect(toDisplayUnit('MUAC', '115', 'mm')).toEqual({ value: '11.5', unit: 'cm' });
  });

  it('labels the plausibility rules as an unapproved assumption', () => {
    expect(MEASUREMENT_RULES_VERSION).toMatch(/ASSUMPTION/);
  });
});

describe('measurement validation (data quality only)', () => {
  it('accepts valid weight, height, length, MUAC and head circumference', () => {
    expect(check({})).not.toThrow();
    expect(check({ value: '3250', unit: 'g' })).not.toThrow();
    expect(check({ type: 'HEIGHT', value: '86.4', unit: 'cm' })).not.toThrow();
    expect(check({ type: 'LENGTH', value: '520', unit: 'mm' })).not.toThrow();
    expect(check({ type: 'MUAC', value: '13.5', unit: 'cm' })).not.toThrow();
    expect(check({ type: 'HEAD_CIRCUMFERENCE', value: '45', unit: 'cm' })).not.toThrow();
  });

  it.each([
    [{ unit: 'cm' as const }, 'INVALID_UNIT'],
    [{ type: 'HEIGHT' as const, value: '80', unit: 'kg' as const }, 'INVALID_UNIT'],
    [{ value: '10.555' }, 'TOO_MANY_DECIMALS'], // would be rounded by the 2-decimal column
    [{ value: '3250.5', unit: 'g' as const }, 'TOO_MANY_DECIMALS'],
    [{ type: 'HEIGHT' as const, value: '86.45', unit: 'cm' as const }, 'TOO_MANY_DECIMALS'],
    [{ value: '300' }, 'IMPLAUSIBLE_VALUE'],
    [{ value: '100', unit: 'g' as const }, 'IMPLAUSIBLE_VALUE'], // 0.1 kg
    [{ value: '0' }, 'IMPLAUSIBLE_VALUE'],
    [{ type: 'MUAC' as const, value: '70', unit: 'cm' as const }, 'IMPLAUSIBLE_VALUE'],
    [{ value: 'abc' }, 'INVALID_NUMBER'],
    [{ measuredAt: new Date(NOW.getTime() + 10 * 60_000) }, 'MEASURED_IN_FUTURE'],
    [{ measuredAt: new Date('2023-12-31T12:00:00Z') }, 'MEASURED_BEFORE_BIRTH'],
  ])('rejects %j with %s', (input, code) => {
    expect(check(input)).toThrow(expect.objectContaining({ code }));
  });

  it('tolerates a device clock up to 5 minutes ahead', () => {
    expect(check({ measuredAt: new Date(NOW.getTime() + 4 * 60_000) })).not.toThrow();
  });

  it('rejects non-decimal formats at the request schema (NaN, Infinity, signs, exponents, numbers)', () => {
    const base = {
      expectedVersion: 1,
      type: 'WEIGHT',
      unit: 'kg',
      source: 'MEASURED',
      quality: 'RELIABLE',
      measuredAt: NOW.toISOString(),
    };
    for (const value of ['NaN', 'Infinity', '-1', '1e3', ' 12', '12.', '.5', '012', '12,5', '', '1234567']) {
      expect(addMeasurementRequestSchema.safeParse({ ...base, value }).success, value).toBe(false);
    }
    expect(addMeasurementRequestSchema.safeParse({ ...base, value: 12.5 }).success).toBe(false);
    expect(addMeasurementRequestSchema.safeParse({ ...base, value: '12.5' }).success).toBe(true);
    expect(addMeasurementRequestSchema.safeParse({ ...base, value: '1', type: 'HAEMOGLOBIN' }).success).toBe(
      false,
    );
    expect(addMeasurementRequestSchema.safeParse({ ...base, value: '1', recordedById: 'x' }).success).toBe(
      false,
    );
  });
});

// -------------------------------------------------------------------------- answers

let qn = 0;
function question(overrides: Partial<ScreeningQuestion>): ScreeningQuestion {
  qn += 1;
  return {
    id: `q${qn}`,
    protocolId: 'p',
    code: `Q${qn}`,
    category: 'DISEASES',
    sectionCode: 'S',
    sortOrder: qn,
    promptKey: 'k',
    helpKey: null,
    prompt: { hi: 'प्र', en: 'Q' },
    help: null,
    answerType: 'YES_NO',
    options: null,
    validation: null,
    isRequired: true,
    ...overrides,
  };
}
const opts = [
  { code: 'A', label: { hi: 'क', en: 'a' } },
  { code: 'B', label: { hi: 'ख', en: 'b' } },
];
const yesNo = question({});
const num = question({ answerType: 'NUMBER', validation: { min: 0, max: 30, maxDecimals: 0 } });
const text = question({ answerType: 'TEXT', validation: { maxLength: 5 } });
const single = question({ answerType: 'SINGLE_CHOICE', options: opts });
const multi = question({ answerType: 'MULTI_CHOICE', options: opts });
const answered = (value: unknown) => ({
  questionId: 'x',
  status: 'ANSWERED' as const,
  source: 'WORKER_OBSERVED' as const,
  value: value as boolean,
});

describe('answer validation (decision G)', () => {
  it('stores YES and NO as booleans, and the other states without any value', () => {
    expect(responseColumns(yesNo, answered(true)).valueBoolean).toBe(true);
    expect(responseColumns(yesNo, answered(false)).valueBoolean).toBe(false);
    for (const status of ['UNKNOWN', 'NOT_ASSESSED', 'UNABLE_TO_ASSESS'] as const) {
      const cols = responseColumns(yesNo, { questionId: 'x', status, source: 'GUARDIAN_REPORTED' });
      expect(cols).toEqual({
        valueBoolean: null,
        valueCode: null,
        valueCodes: [],
        valueNumber: null,
        valueText: null,
      });
    }
  });

  it.each([
    [yesNo, 'yes'],
    [yesNo, 1],
    [num, '5'],
    [num, 31],
    [num, -1],
    [num, 2.5],
    [num, 1e-7],
    [text, '   '],
    [text, 'too long'],
    [single, 'C'],
    [single, ['A']],
    [multi, 'A'],
    [multi, ['A', 'A']],
    [multi, ['A', 'Z']],
  ] as const)('rejects a wrong value for %s: %j', (q, value) => {
    expect(() => responseColumns(q, answered(value))).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
  });

  it('accepts values that match the question', () => {
    expect(responseColumns(num, answered(30)).valueNumber).toBe(30);
    expect(responseColumns(text, answered(' ok ')).valueText).toBe('ok');
    expect(responseColumns(single, answered('B')).valueCode).toBe('B');
    expect(responseColumns(multi, answered(['B', 'A'])).valueCodes).toEqual(['B', 'A']);
  });

  it('reads back no value for UNKNOWN (never "No")', () => {
    const row = { status: 'UNKNOWN', valueBoolean: null } as ScreeningObservation;
    expect(responseValue(yesNo, row)).toBeNull();
    const n = { status: 'ANSWERED', valueNumber: new Prisma.Decimal('4.000') } as ScreeningObservation;
    expect(responseValue(num, n)).toBe(4);
  });
});

describe('completeness counts (decision N)', () => {
  it('counts states separately and never counts a missing answer as answered', () => {
    const q1 = question({});
    const q2 = question({});
    const q3 = question({ isRequired: false });
    const obs = (questionId: string, status: string) => ({ questionId, status }) as ScreeningObservation;
    expect(completeness([q1, q2, q3], [obs(q1.id, 'UNKNOWN')])).toEqual({
      totalQuestions: 3,
      requiredQuestions: 2,
      requiredAddressed: 1,
      answered: 0,
      unknown: 1,
      notAssessed: 0,
      notAnswered: 2,
    });
  });
});

describe('request schemas reject client-controlled server fields (mass assignment)', () => {
  const op = '6f1d1c1e-0000-4000-8000-000000000001';
  it.each([
    ['conductedById', { conductedById: op }],
    ['ageInDaysAtStart', { ageInDaysAtStart: 10 }],
    ['status', { status: 'COMPLETED' }],
    ['screeningConsentId', { screeningConsentId: op }],
    ['areaId', { areaId: op }],
  ])('start screening with %s', (_name, extra) => {
    expect(
      startScreeningRequestSchema.safeParse({ clientOperationId: op, childId: op, ...extra }).success,
    ).toBe(false);
  });

  it('save responses: needs content, unique questions, a value only when ANSWERED', () => {
    const r = { questionId: op, status: 'ANSWERED', source: 'WORKER_OBSERVED', value: true };
    expect(saveResponsesRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(saveResponsesRequestSchema.safeParse({ expectedVersion: 1, responses: [r, r] }).success).toBe(
      false,
    );
    expect(
      saveResponsesRequestSchema.safeParse({ expectedVersion: 1, responses: [{ ...r, value: undefined }] })
        .success,
    ).toBe(false);
    expect(
      saveResponsesRequestSchema.safeParse({ expectedVersion: 1, responses: [{ ...r, status: 'UNKNOWN' }] })
        .success,
    ).toBe(false);
    expect(
      saveResponsesRequestSchema.safeParse({ expectedVersion: 1, responses: [{ ...r, recordedById: op }] })
        .success,
    ).toBe(false);
    expect(
      saveResponsesRequestSchema.safeParse({
        expectedVersion: 1,
        responses: [{ ...r, status: 'UNKNOWN', value: undefined, notAssessedReason: 'x' }],
      }).success,
    ).toBe(false);
    expect(saveResponsesRequestSchema.safeParse({ expectedVersion: 1, responses: [r] }).success).toBe(true);
  });

  it('update category: no completedAt or protocol from the client', () => {
    expect(updateCategoryRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(
      updateCategoryRequestSchema.safeParse({
        expectedVersion: 1,
        status: 'COMPLETED',
        completedAt: NOW.toISOString(),
      }).success,
    ).toBe(false);
    expect(
      updateCategoryRequestSchema.safeParse({ expectedVersion: 1, protocolId: op, notes: 'x' }).success,
    ).toBe(false);
  });
});
