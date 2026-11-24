import {
  OUTCOME_CAUTION_RANK,
  type ClinicalRule,
  type ComparisonOperator,
  type EvidenceRef,
  type ReferralPriority,
  type ResultLimitation,
  type ResultOutcome,
  type RuleCondition,
  type RuleEvaluation,
  type RuleResult,
  type StoredRuleDefinition,
} from '@balswasthya/shared-contracts';

/**
 * Deterministic clinical rule evaluator (Step 7 decisions B-E).
 *
 * PURE: the output depends only on the arguments (no clock, no database, no randomness), so the
 * same screening version and rule set always give the same result, and every case is unit-tested.
 *
 * Safety rules implemented here:
 *  - Three-valued logic. A leaf is UNKNOWN when its input is missing, UNKNOWN, NOT_ASSESSED,
 *    UNABLE_TO_ASSESS, not RELIABLE, conflicting or not understood. all(): any NOT_MET -> NOT_MET,
 *    else any UNKNOWN -> UNKNOWN. any(): any MET -> MET, else any UNKNOWN -> UNKNOWN.
 *  - The DSL has no negation, so missing data can never turn into a reassuring "not met" by "not".
 *  - NO_CONCERN_IN_COMPLETED_ITEMS only when the category is COMPLETED and EVERY applicable rule is
 *    NOT_MET. A MET rule is always reported, even in an unfinished category.
 *  - Input the evaluator does not understand (unknown question code, wrong answer type, wrong
 *    unit dimension) is UNKNOWN with UNSUPPORTED_INPUT - never guessed.
 */
export const ENGINE_VERSION = 'rule-engine/1';

export type ObservationState = 'ANSWERED' | 'UNKNOWN' | 'NOT_ASSESSED' | 'UNABLE_TO_ASSESS';

export interface EvaluationQuestion {
  answerType: 'YES_NO' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'NUMBER' | 'TEXT';
}

export interface EvaluationResponse {
  status: ObservationState;
  value: boolean | number | string | string[] | null;
  ref: EvidenceRef;
}

export interface EvaluationMeasurement {
  type: string;
  /** Decimal string exactly as stored. */
  value: string;
  unit: string;
  /** RELIABLE, QUESTIONABLE or NOT_RELIABLE; only RELIABLE values are used. */
  quality: string;
  ref: EvidenceRef;
}

export interface CategoryInput {
  ageInDays: number;
  /** NOT_STARTED = the category has no row in the session. */
  categoryStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  /** The protocol was ACTIVE and not demonstration content. */
  protocolApproved: boolean;
  /** Questions of the protocol version used, by code. */
  questions: ReadonlyMap<string, EvaluationQuestion>;
  /** Current (amended) answers, by question code. No entry = not answered. */
  responses: ReadonlyMap<string, EvaluationResponse>;
  /** Current measurements of the screening (corrections and amendments applied). */
  measurements: readonly EvaluationMeasurement[];
}

export type RuleSetChoice =
  { kind: 'RULE_SET'; approved: boolean; definition: StoredRuleDefinition } | { kind: 'NONE' | 'AMBIGUOUS' };

export interface CategoryEvaluation {
  outcome: ResultOutcome;
  evaluations: RuleEvaluation[];
  limitations: ResultLimitation[];
  referralRecommended: boolean;
  suggestedPriority: ReferralPriority | null;
}

// --------------------------------------------------------------------- exact decimals

const SCALE = 6;

/** Parses a non-negative or negative decimal string/number into an integer scaled by 10^6. */
export function toScaled(value: string | number): bigint | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? '';
  if (fraction.length > SCALE) return null;
  const scaled = BigInt(match[2]! + fraction.padEnd(SCALE, '0'));
  return match[1] === '-' ? -scaled : scaled;
}

function compare(a: bigint, op: ComparisonOperator, b: bigint): boolean {
  switch (op) {
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'eq':
      return a === b;
  }
}

/** Unit dimension of each measurement type and exact conversion to the rule's unit. */
const DIMENSION: Record<string, 'kg' | 'cm'> = {
  WEIGHT: 'kg',
  HEIGHT: 'cm',
  LENGTH: 'cm',
  MUAC: 'cm',
  HEAD_CIRCUMFERENCE: 'cm',
};
const FACTOR_TO: Record<string, { to: 'kg' | 'cm'; factor: bigint; divisor: bigint }> = {
  kg: { to: 'kg', factor: 1n, divisor: 1n },
  g: { to: 'kg', factor: 1n, divisor: 1000n },
  cm: { to: 'cm', factor: 1n, divisor: 1n },
  mm: { to: 'cm', factor: 1n, divisor: 10n },
};

/** Stored measurement in the rule's unit, scaled by 10^6 (exact: g and mm have no decimals). */
export function measurementInUnit(value: string, unit: string, target: 'kg' | 'cm'): bigint | null {
  const conv = FACTOR_TO[unit];
  const scaled = toScaled(value);
  if (!conv || conv.to !== target || scaled === null) return null;
  const numerator = scaled * conv.factor;
  if (numerator % conv.divisor !== 0n) return null;
  return numerator / conv.divisor;
}

// --------------------------------------------------------------------- evaluation

interface LeafOutcome {
  result: Exclude<RuleResult, 'NOT_APPLICABLE'>;
  evidence: EvidenceRef[];
  limitations: ResultLimitation[];
}

const met = (evidence: EvidenceRef[]): LeafOutcome => ({ result: 'MET', evidence, limitations: [] });
const notMet = (evidence: EvidenceRef[]): LeafOutcome => ({ result: 'NOT_MET', evidence, limitations: [] });
const unknown = (limitation: ResultLimitation, evidence: EvidenceRef[] = []): LeafOutcome => ({
  result: 'UNKNOWN',
  evidence,
  limitations: [limitation],
});

const STATE_LIMITATION = {
  UNKNOWN: 'ANSWER_UNKNOWN',
  NOT_ASSESSED: 'ANSWER_NOT_ASSESSED',
  UNABLE_TO_ASSESS: 'ANSWER_UNABLE_TO_ASSESS',
} as const;

function answered(
  input: CategoryInput,
  question: string,
  expected: readonly EvaluationQuestion['answerType'][],
): { response: EvaluationResponse } | { leaf: LeafOutcome } {
  const q = input.questions.get(question);
  if (!q || !expected.includes(q.answerType)) {
    return { leaf: unknown({ code: 'UNSUPPORTED_INPUT', question }) };
  }
  const response = input.responses.get(question);
  if (!response) return { leaf: unknown({ code: 'ANSWER_MISSING', question }) };
  if (response.status !== 'ANSWERED') {
    return { leaf: unknown({ code: STATE_LIMITATION[response.status], question }, [response.ref]) };
  }
  return { response };
}

function evaluateLeaf(c: RuleCondition, input: CategoryInput): LeafOutcome {
  if ('answerIs' in c) {
    const a = answered(input, c.answerIs.question, ['YES_NO']);
    if ('leaf' in a) return a.leaf;
    if (typeof a.response.value !== 'boolean') {
      return unknown({ code: 'UNSUPPORTED_INPUT', question: c.answerIs.question }, [a.response.ref]);
    }
    return a.response.value === c.answerIs.value ? met([a.response.ref]) : notMet([a.response.ref]);
  }
  if ('answerIn' in c) {
    const a = answered(input, c.answerIn.question, ['SINGLE_CHOICE', 'MULTI_CHOICE']);
    if ('leaf' in a) return a.leaf;
    const v = a.response.value;
    const chosen = typeof v === 'string' ? [v] : Array.isArray(v) ? v : null;
    if (!chosen)
      return unknown({ code: 'UNSUPPORTED_INPUT', question: c.answerIn.question }, [a.response.ref]);
    return chosen.some((code) => c.answerIn.codes.includes(code))
      ? met([a.response.ref])
      : notMet([a.response.ref]);
  }
  if ('answerNumber' in c) {
    const a = answered(input, c.answerNumber.question, ['NUMBER']);
    if ('leaf' in a) return a.leaf;
    const value = typeof a.response.value === 'number' ? toScaled(a.response.value) : null;
    const threshold = toScaled(c.answerNumber.value);
    if (value === null || threshold === null) {
      return unknown({ code: 'UNSUPPORTED_INPUT', question: c.answerNumber.question }, [a.response.ref]);
    }
    return compare(value, c.answerNumber.op, threshold) ? met([a.response.ref]) : notMet([a.response.ref]);
  }
  if (!('measurement' in c)) return unknown({ code: 'UNSUPPORTED_INPUT' });
  const { type, op, unit } = c.measurement;
  const threshold = toScaled(c.measurement.value);
  if (DIMENSION[type] !== unit || threshold === null) {
    return unknown({ code: 'UNSUPPORTED_INPUT', measurement: type });
  }
  const ofType = input.measurements.filter((m) => m.type === type);
  if (ofType.length === 0) return unknown({ code: 'MEASUREMENT_MISSING', measurement: type });
  const reliable = ofType.filter((m) => m.quality === 'RELIABLE');
  if (reliable.length === 0) {
    return unknown(
      { code: 'MEASUREMENT_NOT_RELIABLE', measurement: type },
      ofType.map((m) => m.ref),
    );
  }
  const values = reliable.map((m) => measurementInUnit(m.value, m.unit, unit));
  if (values.some((v) => v === null)) {
    return unknown(
      { code: 'UNSUPPORTED_INPUT', measurement: type },
      reliable.map((m) => m.ref),
    );
  }
  // Two different current values of the same measurement: never pick one.
  if (new Set(values.map(String)).size > 1) {
    return unknown(
      { code: 'MEASUREMENT_CONFLICT', measurement: type },
      reliable.map((m) => m.ref),
    );
  }
  const refs = reliable.map((m) => m.ref);
  return compare(values[0]!, op, threshold) ? met(refs) : notMet(refs);
}

export function evaluateCondition(c: RuleCondition, input: CategoryInput): LeafOutcome {
  if ('all' in c || 'any' in c) {
    const children = ('all' in c ? c.all : c.any).map((child) => evaluateCondition(child, input));
    const evidence = dedupe(children.flatMap((ch) => ch.evidence));
    const limitations = children.flatMap((ch) => ch.limitations);
    const has = (r: LeafOutcome['result']) => children.some((ch) => ch.result === r);
    const result: LeafOutcome['result'] =
      'all' in c
        ? has('NOT_MET')
          ? 'NOT_MET'
          : has('UNKNOWN')
            ? 'UNKNOWN'
            : 'MET'
        : has('MET')
          ? 'MET'
          : has('UNKNOWN')
            ? 'UNKNOWN'
            : 'NOT_MET';
    return { result, evidence, limitations };
  }
  return evaluateLeaf(c, input);
}

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = JSON.stringify(i);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PRIORITY_RANK: Record<ReferralPriority, number> = { ROUTINE: 1, PRIORITY: 2, URGENT: 3 };

function ruleApplies(rule: ClinicalRule, ageInDays: number): boolean {
  return (
    (rule.ageMinDays === undefined || ageInDays >= rule.ageMinDays) &&
    (rule.ageMaxDays === undefined || ageInDays <= rule.ageMaxDays)
  );
}

/** Evaluates one Four-D category of one screening version. */
export function evaluateCategory(input: CategoryInput, choice: RuleSetChoice): CategoryEvaluation {
  const limitations: ResultLimitation[] = [];
  const empty = { evaluations: [], referralRecommended: false, suggestedPriority: null };

  if (input.categoryStatus === 'NOT_STARTED') {
    return { ...empty, outcome: 'NOT_ASSESSED', limitations: [{ code: 'CATEGORY_NOT_STARTED' }] };
  }
  if (input.categoryStatus === 'IN_PROGRESS') limitations.push({ code: 'CATEGORY_INCOMPLETE' });
  if (!input.protocolApproved) limitations.push({ code: 'PROTOCOL_NOT_APPROVED' });

  if (choice.kind !== 'RULE_SET') {
    limitations.push({ code: choice.kind === 'AMBIGUOUS' ? 'AMBIGUOUS_RULE_SET' : 'NO_USABLE_RULE_SET' });
    return { ...empty, outcome: 'NOT_INTERPRETED', limitations };
  }
  if (!choice.approved) limitations.push({ code: 'RULE_SET_NOT_APPROVED' });

  const evaluations: RuleEvaluation[] = [];
  const metRules: ClinicalRule[] = [];
  let anyUnknown = false;
  let anyApplicable = false;
  // Fixed order (by rule id) so stored evidence is identical for identical input.
  const rules = [...choice.definition.rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  for (const rule of rules) {
    if (!ruleApplies(rule, input.ageInDays)) {
      evaluations.push({ ruleId: rule.ruleId, result: 'NOT_APPLICABLE', evidence: [] });
      continue;
    }
    anyApplicable = true;
    const outcome = evaluateCondition(rule.when, input);
    evaluations.push({ ruleId: rule.ruleId, result: outcome.result, evidence: outcome.evidence });
    if (outcome.result === 'MET') metRules.push(rule);
    if (outcome.result === 'UNKNOWN') {
      anyUnknown = true;
      limitations.push(...outcome.limitations.map((l) => ({ ...l, ruleId: rule.ruleId })));
    }
  }

  if (metRules.length > 0) {
    const outcome = metRules.some((r) => r.outcome === 'URGENT_EVALUATION_RECOMMENDED')
      ? 'URGENT_EVALUATION_RECOMMENDED'
      : 'FURTHER_EVALUATION_RECOMMENDED';
    const recommending = metRules.filter((r) => r.referralRecommended);
    const priorities = recommending
      .map((r) => r.suggestedPriority)
      .filter((p): p is ReferralPriority => p !== undefined);
    const suggestedPriority =
      priorities.length > 0
        ? priorities.reduce((a, b) => (PRIORITY_RANK[b] > PRIORITY_RANK[a] ? b : a))
        : null;
    return {
      outcome,
      evaluations,
      limitations: dedupe(limitations),
      referralRecommended: recommending.length > 0,
      suggestedPriority,
    };
  }
  if (!anyApplicable) limitations.push({ code: 'NO_USABLE_RULE_SET' });
  const outcome: ResultOutcome =
    input.categoryStatus === 'IN_PROGRESS'
      ? 'INCOMPLETE'
      : anyUnknown || !anyApplicable
        ? 'UNABLE_TO_DETERMINE'
        : 'NO_CONCERN_IN_COMPLETED_ITEMS';
  return {
    outcome,
    evaluations,
    limitations: dedupe(limitations),
    referralRecommended: false,
    suggestedPriority: null,
  };
}

/** Session-level outcome: the most cautious category outcome. */
export function overallOutcome(outcomes: readonly ResultOutcome[]): ResultOutcome {
  return outcomes.reduce((a, b) => (OUTCOME_CAUTION_RANK[b] > OUTCOME_CAUTION_RANK[a] ? b : a));
}
