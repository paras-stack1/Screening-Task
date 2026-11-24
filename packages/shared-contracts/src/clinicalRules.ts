import { z } from 'zod';
import {
  fourDCategorySchema,
  localizedTextSchema,
  protocolStatusSchema,
  screeningMeasurementTypeSchema,
} from './screening.js';

/**
 * Clinical rule DSL (Step 7 decisions B-D; docs/step-7/clinical-rule-governance.md).
 *
 * A rule set is DATA. This file defines what a rule may say; it contains no rule. Every number a
 * rule compares against is written in the rule set, next to its clinical reference, by the clinical
 * team - the software never supplies one.
 *
 * Design choices that keep evaluation safe:
 *  - There is NO "not" operator. A missing, UNKNOWN or NOT_ASSESSED answer can therefore never make
 *    a rule "not met" through negation, and absence of data can never look reassuring.
 *  - Conditions are evaluated with three values (MET / NOT_MET / UNKNOWN). Missing input is UNKNOWN.
 *  - Only measurements recorded as RELIABLE are used; others are UNKNOWN.
 *  - Size limits (depth, branches, rules) keep evaluation cheap and predictable.
 */

export const RULE_DSL_VERSION = 1 as const;

const ruleCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'Codes are upper-case letters, digits and underscores');

/** Thresholds are written as decimal strings so they are compared exactly (no float rounding). */
const thresholdSchema = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,3})?$/, 'A non-negative decimal with up to 3 decimals, e.g. "11.5"');

export const COMPARISON_OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;
export const comparisonOperatorSchema = z.enum(COMPARISON_OPERATORS);
export type ComparisonOperator = z.infer<typeof comparisonOperatorSchema>;

/** Units a measurement threshold is written in; stored values in g / mm are converted exactly. */
export const RULE_MEASUREMENT_UNITS = ['kg', 'cm'] as const;

export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  /** YES_NO question answered with this value. */
  | { answerIs: { question: string; value: boolean } }
  /** SINGLE_CHOICE answer is one of the codes; MULTI_CHOICE answer contains at least one. */
  | { answerIn: { question: string; codes: string[] } }
  /** NUMBER answer compared with a threshold. */
  | { answerNumber: { question: string; op: ComparisonOperator; value: string } }
  /** Current RELIABLE measurement of this type compared with a threshold. */
  | {
      measurement: {
        type: z.infer<typeof screeningMeasurementTypeSchema>;
        op: ComparisonOperator;
        value: string;
        unit: (typeof RULE_MEASUREMENT_UNITS)[number];
      };
    };

const MAX_BRANCHES = 20;

export const ruleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(ruleConditionSchema).min(1).max(MAX_BRANCHES) }),
    z.strictObject({ any: z.array(ruleConditionSchema).min(1).max(MAX_BRANCHES) }),
    z.strictObject({ answerIs: z.strictObject({ question: ruleCodeSchema, value: z.boolean() }) }),
    z.strictObject({
      answerIn: z.strictObject({
        question: ruleCodeSchema,
        codes: z.array(ruleCodeSchema).min(1).max(MAX_BRANCHES),
      }),
    }),
    z.strictObject({
      answerNumber: z.strictObject({
        question: ruleCodeSchema,
        op: comparisonOperatorSchema,
        value: thresholdSchema,
      }),
    }),
    z.strictObject({
      measurement: z.strictObject({
        type: screeningMeasurementTypeSchema,
        op: comparisonOperatorSchema,
        value: thresholdSchema,
        unit: z.enum(RULE_MEASUREMENT_UNITS),
      }),
    }),
  ]),
);

/** Outcomes a rule may produce when MET. Everything else is decided by the evaluator. */
export const RULE_OUTCOMES = ['FURTHER_EVALUATION_RECOMMENDED', 'URGENT_EVALUATION_RECOMMENDED'] as const;
export const REFERRAL_PRIORITIES = ['ROUTINE', 'PRIORITY', 'URGENT'] as const;
export const referralPrioritySchema = z.enum(REFERRAL_PRIORITIES);
export type ReferralPriority = z.infer<typeof referralPrioritySchema>;

export const clinicalRuleSchema = z
  .strictObject({
    ruleId: ruleCodeSchema,
    name: localizedTextSchema,
    /** Guideline, edition and section that justify THIS rule and its thresholds. */
    clinicalReference: z.string().trim().min(3).max(500),
    /** Optional narrower age band (inclusive days) inside the rule set's band. */
    ageMinDays: z.number().int().min(0).optional(),
    ageMaxDays: z.number().int().min(0).optional(),
    when: ruleConditionSchema,
    outcome: z.enum(RULE_OUTCOMES),
    referralRecommended: z.boolean(),
    suggestedPriority: referralPrioritySchema.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.suggestedPriority && !r.referralRecommended) {
      ctx.addIssue({
        code: 'custom',
        message: 'A priority is only suggested together with a referral recommendation',
        path: ['suggestedPriority'],
      });
    }
    if (r.ageMinDays !== undefined && r.ageMaxDays !== undefined && r.ageMaxDays < r.ageMinDays) {
      ctx.addIssue({ code: 'custom', message: 'ageMaxDays is below ageMinDays', path: ['ageMaxDays'] });
    }
  });
export type ClinicalRule = z.infer<typeof clinicalRuleSchema>;

const MAX_DEPTH = 6;

function conditionDepth(c: RuleCondition): number {
  if ('all' in c) return 1 + Math.max(...c.all.map(conditionDepth));
  if ('any' in c) return 1 + Math.max(...c.any.map(conditionDepth));
  return 1;
}

/** Question codes and measurement types a condition reads (the rule's input requirements). */
export function conditionInputs(c: RuleCondition): { questions: string[]; measurements: string[] } {
  const questions = new Set<string>();
  const measurements = new Set<string>();
  const walk = (n: RuleCondition) => {
    if ('all' in n) n.all.forEach(walk);
    else if ('any' in n) n.any.forEach(walk);
    else if ('answerIs' in n) questions.add(n.answerIs.question);
    else if ('answerIn' in n) questions.add(n.answerIn.question);
    else if ('answerNumber' in n) questions.add(n.answerNumber.question);
    else measurements.add(n.measurement.type);
  };
  walk(c);
  return { questions: [...questions].sort(), measurements: [...measurements].sort() };
}

/** A complete rule set as written by the clinical team (import file format). */
export const clinicalRuleSetDefinitionSchema = z
  .strictObject({
    dslVersion: z.literal(RULE_DSL_VERSION),
    code: ruleCodeSchema,
    version: z.number().int().min(1),
    category: fourDCategorySchema,
    protocolCode: ruleCodeSchema,
    protocolVersions: z.array(z.number().int().min(1)).min(1).max(50),
    name: localizedTextSchema,
    ageMinDays: z.number().int().min(0),
    ageMaxDays: z.number().int().min(0),
    sourceReference: z.string().trim().min(3).max(500),
    isDemonstration: z.boolean(),
    rules: z.array(clinicalRuleSchema).min(1).max(200),
  })
  .superRefine((d, ctx) => {
    if (d.ageMaxDays < d.ageMinDays) {
      ctx.addIssue({ code: 'custom', message: 'ageMaxDays is below ageMinDays', path: ['ageMaxDays'] });
    }
    if (new Set(d.protocolVersions).size !== d.protocolVersions.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Protocol versions are listed twice',
        path: ['protocolVersions'],
      });
    }
    const seen = new Set<string>();
    d.rules.forEach((r, i) => {
      if (seen.has(r.ruleId)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate rule id ${r.ruleId}`,
          path: ['rules', i, 'ruleId'],
        });
      }
      seen.add(r.ruleId);
      if (conditionDepth(r.when) > MAX_DEPTH) {
        ctx.addIssue({
          code: 'custom',
          message: `Condition nested deeper than ${MAX_DEPTH}`,
          path: ['rules', i, 'when'],
        });
      }
      const min = r.ageMinDays ?? d.ageMinDays;
      const max = r.ageMaxDays ?? d.ageMaxDays;
      if (min < d.ageMinDays || max > d.ageMaxDays) {
        ctx.addIssue({
          code: 'custom',
          message: 'A rule age band must lie inside the rule set age band',
          path: ['rules', i],
        });
      }
    });
  });
export type ClinicalRuleSetDefinition = z.infer<typeof clinicalRuleSetDefinitionSchema>;

/** What is stored in ClinicalRuleSet.definition (the other fields are columns). */
export const storedRuleDefinitionSchema = z.strictObject({
  dslVersion: z.literal(RULE_DSL_VERSION),
  rules: z.array(clinicalRuleSchema).min(1).max(200),
});
export type StoredRuleDefinition = z.infer<typeof storedRuleDefinitionSchema>;

// ------------------------------------------------------------------ read API (reviewers)

export const clinicalRuleSetSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  version: z.number(),
  category: fourDCategorySchema,
  protocolCode: z.string(),
  protocolVersions: z.array(z.number()),
  name: localizedTextSchema,
  ageMinDays: z.number(),
  ageMaxDays: z.number(),
  sourceReference: z.string(),
  status: protocolStatusSchema,
  isDemonstration: z.boolean(),
  contentSha256: z.string().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvalReference: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  retiredAt: z.string().nullable(),
  /** True only for ACTIVE, approved, non-demonstration rule sets. */
  isOperational: z.boolean(),
});
export type ClinicalRuleSetSummary = z.infer<typeof clinicalRuleSetSummarySchema>;

export const clinicalRuleSetDetailSchema = clinicalRuleSetSummarySchema.extend({
  rules: z.array(
    z.object({
      ruleId: z.string(),
      name: localizedTextSchema,
      clinicalReference: z.string(),
      ageMinDays: z.number(),
      ageMaxDays: z.number(),
      when: z.unknown(),
      inputs: z.object({ questions: z.array(z.string()), measurements: z.array(z.string()) }),
      outcome: z.enum(RULE_OUTCOMES),
      referralRecommended: z.boolean(),
      suggestedPriority: referralPrioritySchema.nullable(),
    }),
  ),
  history: z.array(
    z.object({
      type: z.enum(['CREATED', 'STATUS_CHANGED']),
      fromStatus: protocolStatusSchema.nullable(),
      toStatus: protocolStatusSchema,
      actorName: z.string(),
      reference: z.string().nullable(),
      contentSha256: z.string().nullable(),
      occurredAt: z.string(),
    }),
  ),
});
export type ClinicalRuleSetDetail = z.infer<typeof clinicalRuleSetDetailSchema>;

export const clinicalRuleSetListQuerySchema = z.strictObject({
  category: fourDCategorySchema.optional(),
  status: protocolStatusSchema.optional(),
});
export type ClinicalRuleSetListQuery = z.infer<typeof clinicalRuleSetListQuerySchema>;
