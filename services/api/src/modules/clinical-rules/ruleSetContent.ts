import { createHash } from 'node:crypto';
import {
  clinicalRuleSetDefinitionSchema,
  conditionInputs,
  storedRuleDefinitionSchema,
  type ClinicalRuleSetDefinition,
  type RuleCondition,
} from '@balswasthya/shared-contracts';
import type { ClinicalRuleSet, Prisma } from '@prisma/client';

/**
 * Rule-set content identity and validation (Step 7 decision B).
 *
 * The SHA-256 of the canonical definition is fixed when a rule set leaves DRAFT. Reviewers approve
 * exactly that hash, and the result generator re-checks it before using a rule set, so content
 * changed outside the governed process is detected instead of used.
 */

/** JSON with object keys sorted at every level; arrays keep their order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalRuleSet(def: ClinicalRuleSetDefinition): string {
  return canonicalJson({
    ...def,
    protocolVersions: [...def.protocolVersions].sort((a, b) => a - b),
    rules: [...def.rules].sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)),
  });
}

export function ruleSetContentHash(def: ClinicalRuleSetDefinition): string {
  return createHash('sha256').update(canonicalRuleSet(def)).digest('hex');
}

export function ruleSetRowToDefinition(row: ClinicalRuleSet): ClinicalRuleSetDefinition {
  const stored = storedRuleDefinitionSchema.parse(row.definition);
  return clinicalRuleSetDefinitionSchema.parse({
    dslVersion: stored.dslVersion,
    code: row.code,
    version: row.version,
    category: row.category,
    protocolCode: row.protocolCode,
    protocolVersions: row.protocolVersions,
    name: { hi: row.nameHi, en: row.nameEn },
    ageMinDays: row.ageMinDays,
    ageMaxDays: row.ageMaxDays,
    sourceReference: row.sourceReference,
    isDemonstration: row.isDemonstration,
    rules: stored.rules,
  });
}

export function ruleSetCreateInput(
  def: ClinicalRuleSetDefinition,
  createdById: string | null,
): Prisma.ClinicalRuleSetUncheckedCreateInput {
  return {
    code: def.code,
    version: def.version,
    category: def.category,
    protocolCode: def.protocolCode,
    protocolVersions: [...def.protocolVersions].sort((a, b) => a - b),
    nameEn: def.name.en,
    nameHi: def.name.hi,
    ageMinDays: def.ageMinDays,
    ageMaxDays: def.ageMaxDays,
    sourceReference: def.sourceReference,
    definition: { dslVersion: def.dslVersion, rules: def.rules },
    isDemonstration: def.isDemonstration,
    createdById,
  };
}

// ------------------------------------------------------------ validation vs protocols

export interface ProtocolForValidation {
  code: string;
  version: number;
  category: string;
  isDemonstration: boolean;
  questions: Array<{ code: string; answerType: string; options: unknown }>;
}

const MEASUREMENT_DIMENSION: Record<string, 'kg' | 'cm'> = {
  WEIGHT: 'kg',
  HEIGHT: 'cm',
  LENGTH: 'cm',
  MUAC: 'cm',
  HEAD_CIRCUMFERENCE: 'cm',
};

function optionCodes(options: unknown): Set<string> {
  if (!Array.isArray(options)) return new Set();
  return new Set(
    options.map((o) => (o as { code?: unknown }).code).filter((c): c is string => typeof c === 'string'),
  );
}

/**
 * Every problem that makes the rule set unusable with the protocol versions it names. An empty list
 * means: every referenced question exists in every listed version with a compatible answer type,
 * every choice code exists, every measurement threshold uses the right unit, and a real
 * (non-demonstration) rule set does not depend on demonstration questions.
 */
export function validateAgainstProtocols(
  def: ClinicalRuleSetDefinition,
  protocols: readonly ProtocolForValidation[],
): string[] {
  const problems: string[] = [];
  const leaves: RuleCondition[] = [];
  const collect = (c: RuleCondition) => {
    if ('all' in c) c.all.forEach(collect);
    else if ('any' in c) c.any.forEach(collect);
    else leaves.push(c);
  };

  for (const version of def.protocolVersions) {
    const protocol = protocols.find((p) => p.code === def.protocolCode && p.version === version);
    if (!protocol) {
      problems.push(`Protocol ${def.protocolCode} v${version} does not exist`);
      continue;
    }
    if (protocol.category !== def.category) {
      problems.push(`Protocol ${def.protocolCode} v${version} is not a ${def.category} protocol`);
    }
    if (protocol.isDemonstration && !def.isDemonstration) {
      problems.push(`A real rule set cannot use demonstration protocol ${def.protocolCode} v${version}`);
    }
    const questions = new Map(protocol.questions.map((q) => [q.code, q]));
    for (const rule of def.rules) {
      leaves.length = 0;
      collect(rule.when);
      for (const leaf of leaves) {
        const where = `rule ${rule.ruleId} (protocol v${version})`;
        if ('measurement' in leaf) {
          if (MEASUREMENT_DIMENSION[leaf.measurement.type] !== leaf.measurement.unit) {
            problems.push(
              `${where}: ${leaf.measurement.type} must be compared in ${MEASUREMENT_DIMENSION[leaf.measurement.type]}`,
            );
          }
          continue;
        }
        const [question, allowed] =
          'answerIs' in leaf
            ? [leaf.answerIs.question, ['YES_NO']]
            : 'answerIn' in leaf
              ? [leaf.answerIn.question, ['SINGLE_CHOICE', 'MULTI_CHOICE']]
              : 'answerNumber' in leaf
                ? [leaf.answerNumber.question, ['NUMBER']]
                : ['', []];
        const q = questions.get(question);
        if (!q) {
          problems.push(`${where}: question ${question} does not exist`);
        } else if (!allowed.includes(q.answerType)) {
          problems.push(`${where}: question ${question} is ${q.answerType}, not ${allowed.join('/')}`);
        } else if ('answerIn' in leaf) {
          const codes = optionCodes(q.options);
          for (const code of leaf.answerIn.codes) {
            if (!codes.has(code)) problems.push(`${where}: question ${question} has no option ${code}`);
          }
        }
      }
    }
  }
  return problems;
}

export { conditionInputs };
