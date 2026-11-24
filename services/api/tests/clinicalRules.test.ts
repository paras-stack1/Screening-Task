import {
  clinicalRuleSetDefinitionSchema,
  conditionInputs,
  RULE_DSL_VERSION,
  type ClinicalRuleSetDefinition,
  type RuleCondition,
} from '@balswasthya/shared-contracts';
import { describe, expect, it } from 'vitest';
import { DEMO_RULE_SETS } from '../src/modules/clinical-rules/demoRuleSets';
import {
  evaluateCategory,
  evaluateCondition,
  measurementInUnit,
  overallOutcome,
  toScaled,
  type CategoryInput,
  type EvaluationResponse,
  type RuleSetChoice,
} from '../src/modules/clinical-rules/evaluator';
import { ruleSetContentHash, validateAgainstProtocols } from '../src/modules/clinical-rules/ruleSetContent';
import { DEMO_PROTOCOLS } from '../src/modules/screening/demoProtocols';

/**
 * Step 7 rule DSL and evaluator. Every rule and number here is SYNTHETIC test data with no
 * clinical meaning; it only exercises the engine's logic.
 */

const ref = (id: string) => ({ kind: 'observation' as const, id });
const yes = (id = 'o1'): EvaluationResponse => ({ status: 'ANSWERED', value: true, ref: ref(id) });
const no = (id = 'o1'): EvaluationResponse => ({ status: 'ANSWERED', value: false, ref: ref(id) });

function input(overrides: Partial<CategoryInput> = {}): CategoryInput {
  return {
    ageInDays: 1000,
    categoryStatus: 'COMPLETED',
    protocolApproved: true,
    questions: new Map([
      ['Q_YN', { answerType: 'YES_NO' }],
      ['Q_YN2', { answerType: 'YES_NO' }],
      ['Q_ONE', { answerType: 'SINGLE_CHOICE' }],
      ['Q_MANY', { answerType: 'MULTI_CHOICE' }],
      ['Q_NUM', { answerType: 'NUMBER' }],
      ['Q_TEXT', { answerType: 'TEXT' }],
    ]),
    responses: new Map(),
    measurements: [],
    ...overrides,
  };
}

const rule = (
  ruleId: string,
  when: RuleCondition,
  extra: Partial<ClinicalRuleSetDefinition['rules'][number]> = {},
): ClinicalRuleSetDefinition['rules'][number] => ({
  ruleId,
  name: { en: `Synthetic ${ruleId}`, hi: `Synthetic ${ruleId}` },
  clinicalReference: 'SYNTHETIC TEST - no clinical meaning',
  when,
  outcome: 'FURTHER_EVALUATION_RECOMMENDED',
  referralRecommended: false,
  ...extra,
});

const choice = (...rules: ClinicalRuleSetDefinition['rules']): RuleSetChoice => ({
  kind: 'RULE_SET',
  approved: true,
  definition: { dslVersion: RULE_DSL_VERSION, rules },
});

const YN: RuleCondition = { answerIs: { question: 'Q_YN', value: true } };
const YN2: RuleCondition = { answerIs: { question: 'Q_YN2', value: true } };

function definition(overrides: Partial<ClinicalRuleSetDefinition> = {}): unknown {
  return {
    dslVersion: 1,
    code: 'SYN_RULES',
    version: 1,
    category: 'DISEASES',
    protocolCode: 'SYN',
    protocolVersions: [1],
    name: { en: 'Synthetic', hi: 'Synthetic' },
    ageMinDays: 0,
    ageMaxDays: 3000,
    sourceReference: 'SYNTHETIC TEST',
    isDemonstration: true,
    rules: [rule('R1', YN)],
    ...overrides,
  };
}

describe('rule DSL', () => {
  it('accepts a well-formed rule set', () => {
    expect(clinicalRuleSetDefinitionSchema.safeParse(definition()).success).toBe(true);
  });

  it('has no negation operator', () => {
    const parsed = clinicalRuleSetDefinitionSchema.safeParse(
      definition({ rules: [rule('R1', { not: YN } as unknown as RuleCondition)] }),
    );
    expect(parsed.success).toBe(false);
  });

  it.each([
    ['duplicate rule ids', { rules: [rule('R1', YN), rule('R1', YN2)] }],
    [
      'priority without a referral recommendation',
      { rules: [rule('R1', YN, { suggestedPriority: 'URGENT' })] },
    ],
    ['rule age band outside the set band', { rules: [rule('R1', YN, { ageMinDays: 0, ageMaxDays: 9999 })] }],
    ['set age band reversed', { ageMinDays: 10, ageMaxDays: 5 }],
    ['lower-case codes', { code: 'syn' }],
    ['no rules', { rules: [] }],
    ['a missing clinical reference', { rules: [rule('R1', YN, { clinicalReference: '' })] }],
    ['duplicate protocol versions', { protocolVersions: [1, 1] }],
  ])('rejects %s', (_label, overrides) => {
    expect(
      clinicalRuleSetDefinitionSchema.safeParse(definition(overrides as Partial<ClinicalRuleSetDefinition>))
        .success,
    ).toBe(false);
  });

  it('rejects thresholds that are not exact decimals (no floats, no units in text)', () => {
    for (const value of ['1e3', '11.5cm', '-1', '1.2345', 11.5]) {
      const when = { answerNumber: { question: 'Q_NUM', op: 'gte', value } } as unknown as RuleCondition;
      expect(
        clinicalRuleSetDefinitionSchema.safeParse(definition({ rules: [rule('R1', when)] })).success,
      ).toBe(false);
    }
  });

  it('rejects conditions nested deeper than 6 levels', () => {
    let deep: RuleCondition = YN;
    for (let i = 0; i < 7; i += 1) deep = { all: [deep] };
    expect(clinicalRuleSetDefinitionSchema.safeParse(definition({ rules: [rule('R1', deep)] })).success).toBe(
      false,
    );
  });

  it("derives each rule's input requirements", () => {
    expect(
      conditionInputs({
        any: [YN, { measurement: { type: 'MUAC', op: 'lt', value: '1', unit: 'cm' } }, YN],
      }),
    ).toEqual({ questions: ['Q_YN'], measurements: ['MUAC'] });
  });
});

describe('content hash', () => {
  it('ignores rule order and key order, but not content', () => {
    const a = clinicalRuleSetDefinitionSchema.parse(definition({ rules: [rule('R1', YN), rule('R2', YN2)] }));
    const b = clinicalRuleSetDefinitionSchema.parse(definition({ rules: [rule('R2', YN2), rule('R1', YN)] }));
    const c = clinicalRuleSetDefinitionSchema.parse(
      definition({ rules: [rule('R1', YN), rule('R2', { answerIs: { question: 'Q_YN2', value: false } })] }),
    );
    expect(ruleSetContentHash(a)).toBe(ruleSetContentHash(b));
    expect(ruleSetContentHash(a)).not.toBe(ruleSetContentHash(c));
  });
});

describe('exact decimals', () => {
  it('scales and converts without floating-point error', () => {
    expect(toScaled('0.1')! + toScaled('0.2')!).toBe(toScaled('0.3'));
    expect(toScaled('1.2345678')).toBeNull();
    expect(measurementInUnit('3250', 'g', 'kg')).toBe(toScaled('3.25'));
    expect(measurementInUnit('115', 'mm', 'cm')).toBe(toScaled('11.5'));
    expect(measurementInUnit('11.5', 'cm', 'kg')).toBeNull(); // wrong dimension
  });
});

describe('three-valued conditions', () => {
  it('a missing answer is UNKNOWN, never NOT_MET', () => {
    const r = evaluateCondition(YN, input());
    expect(r.result).toBe('UNKNOWN');
    expect(r.limitations).toEqual([{ code: 'ANSWER_MISSING', question: 'Q_YN' }]);
  });

  it.each([
    ['UNKNOWN', 'ANSWER_UNKNOWN'],
    ['NOT_ASSESSED', 'ANSWER_NOT_ASSESSED'],
    ['UNABLE_TO_ASSESS', 'ANSWER_UNABLE_TO_ASSESS'],
  ] as const)('a %s answer is UNKNOWN (%s)', (status, code) => {
    const r = evaluateCondition(
      YN,
      input({ responses: new Map([['Q_YN', { status, value: null, ref: ref('o1') }]]) }),
    );
    expect(r.result).toBe('UNKNOWN');
    expect(r.limitations[0]!.code).toBe(code);
  });

  it('all(): NOT_MET wins over UNKNOWN; otherwise UNKNOWN wins over MET', () => {
    const cond: RuleCondition = { all: [YN, YN2] };
    expect(evaluateCondition(cond, input({ responses: new Map([['Q_YN', no()]]) })).result).toBe('NOT_MET');
    expect(evaluateCondition(cond, input({ responses: new Map([['Q_YN', yes()]]) })).result).toBe('UNKNOWN');
    expect(
      evaluateCondition(
        cond,
        input({
          responses: new Map([
            ['Q_YN', yes()],
            ['Q_YN2', yes('o2')],
          ]),
        }),
      ).result,
    ).toBe('MET');
  });

  it('any(): MET wins over UNKNOWN; otherwise UNKNOWN wins over NOT_MET', () => {
    const cond: RuleCondition = { any: [YN, YN2] };
    expect(evaluateCondition(cond, input({ responses: new Map([['Q_YN', yes()]]) })).result).toBe('MET');
    expect(evaluateCondition(cond, input({ responses: new Map([['Q_YN', no()]]) })).result).toBe('UNKNOWN');
    expect(
      evaluateCondition(
        cond,
        input({
          responses: new Map([
            ['Q_YN', no()],
            ['Q_YN2', no('o2')],
          ]),
        }),
      ).result,
    ).toBe('NOT_MET');
  });

  it('choice questions: single value in list, multi value containing any', () => {
    const one: RuleCondition = { answerIn: { question: 'Q_ONE', codes: ['B', 'C'] } };
    const many: RuleCondition = { answerIn: { question: 'Q_MANY', codes: ['C'] } };
    const answers = (v: string | string[]) =>
      input({
        responses: new Map([
          ['Q_ONE', { status: 'ANSWERED', value: v, ref: ref('o1') }],
          ['Q_MANY', { status: 'ANSWERED', value: v, ref: ref('o2') }],
        ]),
      });
    expect(evaluateCondition(one, answers('B')).result).toBe('MET');
    expect(evaluateCondition(one, answers('A')).result).toBe('NOT_MET');
    expect(evaluateCondition(many, answers(['A', 'C'])).result).toBe('MET');
    expect(evaluateCondition(many, answers(['A'])).result).toBe('NOT_MET');
  });

  it('numbers compare exactly at the threshold', () => {
    const at = (v: number) =>
      input({ responses: new Map([['Q_NUM', { status: 'ANSWERED', value: v, ref: ref('o1') }]]) });
    const gte: RuleCondition = { answerNumber: { question: 'Q_NUM', op: 'gte', value: '10.1' } };
    expect(evaluateCondition(gte, at(10.1)).result).toBe('MET');
    expect(evaluateCondition(gte, at(10.099)).result).toBe('NOT_MET');
  });

  it('input the engine does not understand is UNSUPPORTED_INPUT, never guessed', () => {
    for (const cond of [
      { answerIs: { question: 'Q_NOT_IN_PROTOCOL', value: true } },
      { answerIs: { question: 'Q_TEXT', value: true } }, // wrong answer type
      { measurement: { type: 'WEIGHT', op: 'lt', value: '1', unit: 'cm' } }, // wrong unit dimension
    ] as RuleCondition[]) {
      const r = evaluateCondition(cond, input({ responses: new Map([['Q_TEXT', yes()]]) }));
      expect(r.result).toBe('UNKNOWN');
      expect(r.limitations[0]!.code).toBe('UNSUPPORTED_INPUT');
    }
  });

  it('measurements: missing, not reliable and conflicting values are UNKNOWN', () => {
    const cond: RuleCondition = { measurement: { type: 'WEIGHT', op: 'lt', value: '10', unit: 'kg' } };
    const m = (id: string, value: string, unit: string, quality = 'RELIABLE') => ({
      type: 'WEIGHT',
      value,
      unit,
      quality,
      ref: { kind: 'measurement' as const, id },
    });
    const code = (measurements: CategoryInput['measurements']) =>
      evaluateCondition(cond, input({ measurements })).limitations[0]?.code;
    expect(code([])).toBe('MEASUREMENT_MISSING');
    expect(code([m('a', '9', 'kg', 'QUESTIONABLE')])).toBe('MEASUREMENT_NOT_RELIABLE');
    expect(code([m('a', '9', 'kg'), m('b', '9.5', 'kg')])).toBe('MEASUREMENT_CONFLICT');
    // The same value in different units is not a conflict.
    expect(
      evaluateCondition(cond, input({ measurements: [m('a', '9', 'kg'), m('b', '9000', 'g')] })).result,
    ).toBe('MET');
    // Unreliable values are ignored when a reliable one exists.
    expect(
      evaluateCondition(
        cond,
        input({ measurements: [m('a', '12', 'kg'), m('b', '1', 'kg', 'NOT_RELIABLE')] }),
      ).result,
    ).toBe('NOT_MET');
  });
});

describe('category outcome', () => {
  it('a category never started is NOT_ASSESSED', () => {
    expect(evaluateCategory(input({ categoryStatus: 'NOT_STARTED' }), choice(rule('R1', YN))).outcome).toBe(
      'NOT_ASSESSED',
    );
  });

  it('without a usable rule set: NOT_INTERPRETED (observations only), even with a clear answer', () => {
    const r = evaluateCategory(input({ responses: new Map([['Q_YN', yes()]]) }), { kind: 'NONE' });
    expect(r).toMatchObject({ outcome: 'NOT_INTERPRETED', evaluations: [], referralRecommended: false });
    expect(r.limitations).toContainEqual({ code: 'NO_USABLE_RULE_SET' });
    expect(evaluateCategory(input(), { kind: 'AMBIGUOUS' }).limitations).toContainEqual({
      code: 'AMBIGUOUS_RULE_SET',
    });
  });

  it('NO_CONCERN only when complete and every rule is NOT_MET', () => {
    const responses = new Map([
      ['Q_YN', no()],
      ['Q_YN2', no('o2')],
    ]);
    const rules = choice(rule('R1', YN), rule('R2', YN2));
    expect(evaluateCategory(input({ responses }), rules).outcome).toBe('NO_CONCERN_IN_COMPLETED_ITEMS');
    // One unanswered input: never reassuring.
    expect(evaluateCategory(input({ responses: new Map([['Q_YN', no()]]) }), rules).outcome).toBe(
      'UNABLE_TO_DETERMINE',
    );
    // Unfinished category: INCOMPLETE, not "no concern".
    expect(evaluateCategory(input({ responses, categoryStatus: 'IN_PROGRESS' }), rules).outcome).toBe(
      'INCOMPLETE',
    );
  });

  it('a MET rule is reported even in an unfinished category, with the limitation', () => {
    const r = evaluateCategory(
      input({ categoryStatus: 'IN_PROGRESS', responses: new Map([['Q_YN', yes()]]) }),
      choice(rule('R1', YN)),
    );
    expect(r.outcome).toBe('FURTHER_EVALUATION_RECOMMENDED');
    expect(r.limitations).toContainEqual({ code: 'CATEGORY_INCOMPLETE' });
  });

  it('URGENT wins over FURTHER; the highest suggested priority of recommending rules wins', () => {
    const r = evaluateCategory(
      input({
        responses: new Map([
          ['Q_YN', yes()],
          ['Q_YN2', yes('o2')],
        ]),
      }),
      choice(
        rule('R1', YN, { referralRecommended: true, suggestedPriority: 'ROUTINE' }),
        rule('R2', YN2, {
          outcome: 'URGENT_EVALUATION_RECOMMENDED',
          referralRecommended: true,
          suggestedPriority: 'PRIORITY',
        }),
      ),
    );
    expect(r).toMatchObject({
      outcome: 'URGENT_EVALUATION_RECOMMENDED',
      referralRecommended: true,
      suggestedPriority: 'PRIORITY',
    });
  });

  it('rules outside their age band are NOT_APPLICABLE; none applicable is UNABLE_TO_DETERMINE', () => {
    const r = evaluateCategory(
      input({ ageInDays: 100, responses: new Map([['Q_YN', yes()]]) }),
      choice(rule('R1', YN, { ageMinDays: 500 })),
    );
    expect(r.evaluations[0]!.result).toBe('NOT_APPLICABLE');
    expect(r.outcome).toBe('UNABLE_TO_DETERMINE');
  });

  it('marks unapproved protocols and rule sets', () => {
    const r = evaluateCategory(input({ protocolApproved: false, responses: new Map([['Q_YN', no()]]) }), {
      ...choice(rule('R1', YN)),
      approved: false,
    } as RuleSetChoice);
    expect(r.limitations).toEqual(
      expect.arrayContaining([{ code: 'PROTOCOL_NOT_APPROVED' }, { code: 'RULE_SET_NOT_APPROVED' }]),
    );
  });

  it('is deterministic: same input, same output (rules evaluated in id order)', () => {
    const responses = new Map([['Q_YN', yes()]]);
    const a = evaluateCategory(input({ responses }), choice(rule('R2', YN2), rule('R1', YN)));
    const b = evaluateCategory(input({ responses }), choice(rule('R1', YN), rule('R2', YN2)));
    expect(a).toEqual(b);
    expect(a.evaluations.map((e) => e.ruleId)).toEqual(['R1', 'R2']);
  });

  it('session outcome is the most cautious category outcome', () => {
    expect(overallOutcome(['NO_CONCERN_IN_COMPLETED_ITEMS', 'NOT_ASSESSED'])).toBe('NOT_ASSESSED');
    expect(overallOutcome(['NOT_INTERPRETED', 'INCOMPLETE'])).toBe('INCOMPLETE');
    expect(overallOutcome(['UNABLE_TO_DETERMINE', 'FURTHER_EVALUATION_RECOMMENDED'])).toBe(
      'FURTHER_EVALUATION_RECOMMENDED',
    );
  });
});

describe('validation against protocols', () => {
  const protocol = {
    code: 'SYN',
    version: 1,
    category: 'DISEASES',
    isDemonstration: false,
    questions: [
      { code: 'Q_YN', answerType: 'YES_NO', options: null },
      { code: 'Q_ONE', answerType: 'SINGLE_CHOICE', options: [{ code: 'A' }] },
    ],
  };
  const def = (rules: ClinicalRuleSetDefinition['rules'], extra: Partial<ClinicalRuleSetDefinition> = {}) =>
    clinicalRuleSetDefinitionSchema.parse(definition({ rules, isDemonstration: false, ...extra }));

  it('passes when every input exists with a compatible type', () => {
    expect(validateAgainstProtocols(def([rule('R1', YN)]), [protocol])).toEqual([]);
  });

  it('lists every problem', () => {
    const problems = validateAgainstProtocols(
      def(
        [
          rule('R1', { answerIs: { question: 'Q_MISSING', value: true } }),
          rule('R2', { answerNumber: { question: 'Q_YN', op: 'gt', value: '1' } }),
          rule('R3', { answerIn: { question: 'Q_ONE', codes: ['Z'] } }),
        ],
        { protocolVersions: [1, 2] },
      ),
      [protocol],
    );
    expect(problems).toEqual([
      'rule R1 (protocol v1): question Q_MISSING does not exist',
      'rule R2 (protocol v1): question Q_YN is YES_NO, not NUMBER',
      'rule R3 (protocol v1): question Q_ONE has no option Z',
      'Protocol SYN v2 does not exist',
    ]);
  });

  it('a real rule set cannot depend on demonstration questions', () => {
    expect(validateAgainstProtocols(def([rule('R1', YN)]), [{ ...protocol, isDemonstration: true }])).toEqual(
      ['A real rule set cannot use demonstration protocol SYN v1'],
    );
  });

  it('the demonstration rule sets fit the demonstration protocols and contain no measurement threshold', () => {
    for (const set of DEMO_RULE_SETS) {
      expect(set.isDemonstration).toBe(true);
      const protocols = DEMO_PROTOCOLS.filter((p) => p.code === set.protocolCode).map((p) => ({
        ...p,
        questions: p.questions.map((q) => ({
          code: q.code,
          answerType: q.answerType,
          options: q.options ?? null,
        })),
      }));
      expect(validateAgainstProtocols(set, protocols)).toEqual([]);
      expect(set.rules.every((r) => conditionInputs(r.when).measurements.length === 0)).toBe(true);
    }
  });
});
