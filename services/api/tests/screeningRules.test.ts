import {
  ageInDaysOn,
  CHILD_MAX_AGE_YEARS,
  daysBetween,
  parseCalendarDate,
  protocolDefinitionSchema,
  screeningEligibilityResponseSchema,
  type CalendarDate,
  type ProtocolDefinition,
} from '@balswasthya/shared-contracts';
import { describe, expect, it } from 'vitest';
import { toDbDate } from '../src/modules/children/birthDate';
import { DEMO_AGE_MAX_DAYS, DEMO_PROTOCOLS } from '../src/modules/screening/demoProtocols';
import { canonicalProtocolContent, protocolContentHash } from '../src/modules/screening/protocolContent';
import { isUsable, selectProtocol, type ProtocolCandidate } from '../src/modules/screening/protocolSelection';
import { screeningAge } from '../src/modules/screening/screeningAge';

/** Step 6, stage 6B: pure screening rules (age, protocol selection, content identity). */

const d = (iso: string): CalendarDate => parseCalendarDate(iso)!;

describe('age in completed days (decision O)', () => {
  it.each([
    ['2026-11-22', '2026-11-22', 0],
    ['2026-11-21', '2026-11-22', 1],
    ['2023-12-31', '2024-01-01', 1], // year boundary
    ['2024-01-31', '2024-02-01', 1], // month boundary
    ['2024-02-28', '2024-03-01', 2], // leap year: 29 Feb exists
    ['2023-02-28', '2023-03-01', 1], // non-leap year
    ['2024-02-29', '2025-02-28', 365], // born on a leap day
    ['2024-01-01', '2025-01-01', 366], // a leap year has 366 days
    ['2025-01-01', '2026-01-01', 365],
    ['2008-11-22', '2026-11-22', 6574], // 18 years incl. 5 leap days (2008,12,16,20,24)
  ])('born %s, screened %s -> %i days', (birth, on, days) => {
    expect(ageInDaysOn(d(birth), d(on))).toBe(days);
  });

  it('never invents an age for a birth date after the screening date', () => {
    expect(ageInDaysOn(d('2026-11-23'), d('2026-11-22'))).toBeNull();
    expect(daysBetween(d('2026-11-23'), d('2026-11-22'))).toBe(-1);
  });

  it('uses the India calendar date, not the UTC date', () => {
    // 19:00 UTC on 21 Nov = 00:30 IST on 22 Nov: a child born on 22 Nov is 0 days old, not -1.
    const age = screeningAge(toDbDate(d('2026-11-22')), false, new Date('2026-11-21T19:00:00Z'));
    expect(age.screeningDate).toEqual(d('2026-11-22'));
    expect(age.ageInDays).toBe(0);
    expect(age.age).toEqual({ years: 0, months: 0 });
  });

  it('reports a future date of birth as undeterminable (no age, no band)', () => {
    const age = screeningAge(toDbDate(d('2026-12-01')), false, new Date('2026-11-22T06:00:00Z'));
    expect(age.ageInDays).toBeNull();
    expect(age.age).toBeNull();
  });

  it('keeps the estimated-date flag with the age', () => {
    const age = screeningAge(toDbDate(d('2024-05-22')), true, new Date('2026-11-22T06:00:00Z'));
    expect(age.dobIsEstimated).toBe(true);
    expect(age.age).toEqual({ years: 2, months: 6 });
  });
});

// ------------------------------------------------------------------------ selection

const NOW = new Date('2026-11-22T06:00:00Z');
const DEV = { allowDraftProtocols: true };
const PROD = { allowDraftProtocols: false };
let seq = 0;
function candidate(overrides: Partial<ProtocolCandidate>): ProtocolCandidate {
  seq += 1;
  return {
    id: `p${seq}`,
    code: `P${seq}`,
    version: 1,
    category: 'DEFICIENCIES',
    status: 'ACTIVE',
    ageMinDays: 0,
    ageMaxDays: 1000,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('protocol selection (decisions B, F, O)', () => {
  it('uses the ACTIVE protocol covering the age, inclusive at both band edges', () => {
    const band = candidate({ ageMinDays: 100, ageMaxDays: 200 });
    for (const age of [100, 150, 200]) {
      expect(selectProtocol([band], 'DEFICIENCIES', age, PROD, NOW).protocol).toBe(band);
    }
    expect(selectProtocol([band], 'DEFICIENCIES', 99, PROD, NOW).reason).toBe('NO_PROTOCOL_FOR_AGE');
    expect(selectProtocol([band], 'DEFICIENCIES', 201, PROD, NOW).reason).toBe('NO_PROTOCOL_FOR_AGE');
  });

  it('never falls back to a protocol of another category or a nearby band', () => {
    const other = candidate({ category: 'DISEASES' });
    expect(selectProtocol([other], 'DEFICIENCIES', 10, PROD, NOW)).toEqual({
      protocol: null,
      reason: 'NO_PROTOCOL_FOR_AGE',
    });
  });

  it('gives no protocol when the age is undeterminable', () => {
    expect(selectProtocol([candidate({})], 'DEFICIENCIES', null, PROD, NOW).reason).toBe(
      'NO_PROTOCOL_FOR_AGE',
    );
  });

  it('ignores an ACTIVE protocol whose effective date is in the future', () => {
    const later = candidate({ effectiveFrom: new Date('2027-01-01T00:00:00Z') });
    expect(isUsable(later, PROD, NOW)).toBe(false);
    expect(selectProtocol([later], 'DEFICIENCIES', 10, PROD, NOW).protocol).toBeNull();
  });

  it('never uses IN_REVIEW, APPROVED (not active) or RETIRED protocols, even in development', () => {
    for (const status of ['IN_REVIEW', 'APPROVED', 'RETIRED'] as const) {
      expect(isUsable(candidate({ status }), DEV, NOW)).toBe(false);
    }
  });

  it('uses DRAFT protocols only where the policy allows (never in production)', () => {
    const draft = candidate({ status: 'DRAFT', effectiveFrom: null });
    expect(selectProtocol([draft], 'DEFICIENCIES', 10, PROD, NOW).protocol).toBeNull();
    expect(selectProtocol([draft], 'DEFICIENCIES', 10, DEV, NOW).protocol).toBe(draft);
  });

  it('prefers ACTIVE content over drafts', () => {
    const active = candidate({});
    const draft = candidate({ status: 'DRAFT', effectiveFrom: null });
    expect(selectProtocol([draft, active], 'DEFICIENCIES', 10, DEV, NOW).protocol).toBe(active);
  });

  it('uses the latest draft version of a code, but refuses to choose between two draft codes', () => {
    const v1 = candidate({ code: 'X', version: 1, status: 'DRAFT', effectiveFrom: null });
    const v2 = candidate({ code: 'X', version: 2, status: 'DRAFT', effectiveFrom: null });
    expect(selectProtocol([v1, v2], 'DEFICIENCIES', 10, DEV, NOW).protocol).toBe(v2);
    const y = candidate({ code: 'Y', status: 'DRAFT', effectiveFrom: null });
    expect(selectProtocol([v1, v2, y], 'DEFICIENCIES', 10, DEV, NOW)).toEqual({
      protocol: null,
      reason: 'AMBIGUOUS_PROTOCOL',
    });
  });

  it('reports AMBIGUOUS rather than picking when two ACTIVE protocols overlap', () => {
    // The database exclusion constraint prevents this; selection still must not guess.
    expect(selectProtocol([candidate({}), candidate({})], 'DEFICIENCIES', 10, PROD, NOW).reason).toBe(
      'AMBIGUOUS_PROTOCOL',
    );
  });
});

// ---------------------------------------------------------------- content identity

const BASE: ProtocolDefinition = protocolDefinitionSchema.parse({
  code: 'TEST_P',
  version: 1,
  category: 'DISEASES',
  name: { hi: 'परीक्षण', en: 'Test' },
  ageMinDays: 0,
  ageMaxDays: 100,
  sourceReference: 'synthetic',
  isDemonstration: true,
  questions: [
    {
      code: 'Q1',
      sectionCode: 'S1',
      sortOrder: 10,
      prompt: { hi: 'प्रश्न 1', en: 'Question 1' },
      answerType: 'YES_NO',
      isRequired: true,
    },
    {
      code: 'Q2',
      sectionCode: 'S1',
      sortOrder: 20,
      prompt: { hi: 'प्रश्न 2', en: 'Question 2' },
      answerType: 'NUMBER',
      validation: { min: 0, max: 30, maxDecimals: 0, unit: 'days' },
      isRequired: false,
    },
  ],
});

describe('protocol content hash (decisions C, D)', () => {
  it('is deterministic and independent of question order', () => {
    const reversed = { ...BASE, questions: [...BASE.questions].reverse() };
    expect(protocolContentHash(reversed)).toBe(protocolContentHash(BASE));
    expect(protocolContentHash(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any wording, rule, band or answer type changes', () => {
    const base = protocolContentHash(BASE);
    const variants: ProtocolDefinition[] = [
      { ...BASE, name: { ...BASE.name, hi: 'परीक्षण २' } },
      { ...BASE, ageMaxDays: 101 },
      { ...BASE, sourceReference: 'other' },
      {
        ...BASE,
        questions: [
          { ...BASE.questions[0]!, prompt: { hi: 'प्रश्न 1', en: 'Question one' } },
          BASE.questions[1]!,
        ],
      },
      {
        ...BASE,
        questions: [
          BASE.questions[0]!,
          { ...BASE.questions[1]!, validation: { min: 0, max: 31, maxDecimals: 0, unit: 'days' } },
        ],
      },
      { ...BASE, questions: [{ ...BASE.questions[0]!, isRequired: false }, BASE.questions[1]!] },
    ];
    for (const v of variants) expect(protocolContentHash(v)).not.toBe(base);
  });

  it('canonical content has no undefined values (stable JSON)', () => {
    expect(JSON.stringify(canonicalProtocolContent(BASE))).not.toContain('undefined');
    expect(canonicalProtocolContent(BASE).description).toBeNull();
  });
});

describe('protocol definition validation', () => {
  const q = BASE.questions[0]!;
  const bad: Array<[string, unknown]> = [
    ['choice question without options', { ...BASE, questions: [{ ...q, answerType: 'SINGLE_CHOICE' }] }],
    [
      'options on a yes/no question',
      {
        ...BASE,
        questions: [
          {
            ...q,
            options: [
              { code: 'A', label: { hi: 'क', en: 'a' } },
              { code: 'B', label: { hi: 'ख', en: 'b' } },
            ],
          },
        ],
      },
    ],
    ['duplicate question codes', { ...BASE, questions: [q, q] }],
    ['number rules on a yes/no question', { ...BASE, questions: [{ ...q, validation: { min: 1 } }] }],
    [
      'min above max',
      { ...BASE, questions: [{ ...q, answerType: 'NUMBER', validation: { min: 5, max: 1 } }] },
    ],
    ['missing Hindi wording', { ...BASE, questions: [{ ...q, prompt: { en: 'Only English' } }] }],
    ['inverted age band', { ...BASE, ageMinDays: 10, ageMaxDays: 5 }],
    ['no questions', { ...BASE, questions: [] }],
    ['empty source reference', { ...BASE, sourceReference: ' ' }],
    ['lower-case code', { ...BASE, code: 'lower' }],
  ];
  it.each(bad)('rejects %s', (_name, value) => {
    expect(protocolDefinitionSchema.safeParse(value).success).toBe(false);
  });
});

describe('demonstration protocols (decision F)', () => {
  it('provides one DRAFT-only demonstration protocol per Four-D category', () => {
    expect(DEMO_PROTOCOLS.map((p) => p.category).sort()).toEqual([
      'DEFECTS_AT_BIRTH',
      'DEFICIENCIES',
      'DEVELOPMENTAL_DELAYS_DISABILITIES',
      'DISEASES',
    ]);
    for (const p of DEMO_PROTOCOLS) expect(p.isDemonstration).toBe(true);
  });

  it('marks every text as a placeholder in both languages and claims no clinical source', () => {
    for (const p of DEMO_PROTOCOLS) {
      expect(p.name.en).toMatch(/not clinically approved/);
      expect(p.name.hi).toMatch(/स्वीकृत नहीं/);
      expect(p.sourceReference).toMatch(/^NONE/);
      for (const question of p.questions) {
        expect(question.prompt.en).toMatch(/^Demonstration question \d+ .*not a clinical question/);
        expect(question.prompt.hi).toMatch(/^प्रदर्शन प्रश्न/);
      }
    }
  });

  it('uses one band over the whole registration range (no invented age bands)', () => {
    const oldest = ageInDaysOn(d('2007-11-23'), d('2026-11-22'))!; // 18 years, 364 days
    expect(oldest).toBeLessThanOrEqual(DEMO_AGE_MAX_DAYS);
    expect(DEMO_AGE_MAX_DAYS).toBe((CHILD_MAX_AGE_YEARS + 1) * 366);
    for (const p of DEMO_PROTOCOLS) {
      expect([p.ageMinDays, p.ageMaxDays]).toEqual([0, DEMO_AGE_MAX_DAYS]);
    }
  });

  it('exercises every answer type across the four protocols', () => {
    const types = new Set(DEMO_PROTOCOLS.flatMap((p) => p.questions.map((q) => q.answerType)));
    expect([...types].sort()).toEqual(['MULTI_CHOICE', 'NUMBER', 'SINGLE_CHOICE', 'TEXT', 'YES_NO']);
  });
});

describe('eligibility contract', () => {
  it('rejects a response without the consent status', () => {
    expect(
      screeningEligibilityResponseSchema.safeParse({
        childId: 'c',
        screeningDate: '2026-11-22',
        dateOfBirth: '2024-01-01',
        dobIsEstimated: false,
        ageInDays: 10,
        age: { years: 0, months: 0 },
        openSessionId: null,
        categories: [],
        canStart: true,
        blockers: [],
        usesUnapprovedContent: false,
      }).success,
    ).toBe(false);
  });
});
