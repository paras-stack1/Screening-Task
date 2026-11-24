import {
  clinicalRuleSetDefinitionSchema,
  RULE_DSL_VERSION,
  type ClinicalRuleSetDefinition,
} from '@balswasthya/shared-contracts';
import type { PrismaClient } from '@prisma/client';
import { DEMO_AGE_MAX_DAYS } from '../screening/demoProtocols';
import { importRuleSet } from './ruleSetLifecycle';

/**
 * DEMONSTRATION RULE SETS (Step 7 decision C).
 *
 * !!! NONE OF THIS IS CLINICAL CONTENT. !!!
 * They exist only so result generation, review and referral workflows can be built and tested
 * before the clinical team supplies approved rules. They:
 *  - refer ONLY to the numbered placeholder questions of the DEMO_D1..D4 protocols;
 *  - deliberately contain NO measurement threshold, so no real-looking clinical number exists in
 *    the code base;
 *  - are DRAFT with isDemonstration = true, which the database refuses to approve;
 *  - are used only where draft content is allowed (never in production), and every result made
 *    with them is labelled "demonstration - not for clinical use".
 */
const SOURCE = 'NONE - engineering demonstration rules; not based on any clinical guideline';
const REFERENCE = 'NONE - demonstration rule; no clinical meaning';

const name = (en: string, hi: string) => ({ en, hi });

function demoSet(
  short: 'D1' | 'D2' | 'D3' | 'D4',
  category: ClinicalRuleSetDefinition['category'],
  rules: ClinicalRuleSetDefinition['rules'],
): ClinicalRuleSetDefinition {
  return clinicalRuleSetDefinitionSchema.parse({
    dslVersion: RULE_DSL_VERSION,
    code: `DEMO_RULES_${short}`,
    version: 1,
    category,
    protocolCode: `DEMO_${short}`,
    protocolVersions: [1],
    name: name(
      `Demonstration rules - ${short} (not clinically approved)`,
      `प्रदर्शन नियम - ${short} (चिकित्सकीय रूप से स्वीकृत नहीं)`,
    ),
    ageMinDays: 0,
    ageMaxDays: DEMO_AGE_MAX_DAYS,
    sourceReference: SOURCE,
    isDemonstration: true,
    rules,
  });
}

const rule = (
  ruleId: string,
  when: ClinicalRuleSetDefinition['rules'][number]['when'],
  outcome: 'FURTHER_EVALUATION_RECOMMENDED' | 'URGENT_EVALUATION_RECOMMENDED',
  referral: 'ROUTINE' | 'PRIORITY' | 'URGENT' | null,
) => ({
  ruleId,
  name: name(`Demonstration rule ${ruleId}`, `प्रदर्शन नियम ${ruleId}`),
  clinicalReference: REFERENCE,
  when,
  outcome,
  referralRecommended: referral !== null,
  ...(referral ? { suggestedPriority: referral } : {}),
});

export const DEMO_RULE_SETS: readonly ClinicalRuleSetDefinition[] = [
  demoSet('D1', 'DEFECTS_AT_BIRTH', [
    rule(
      'DEMO_R1',
      { answerIs: { question: 'DEMO_Q1', value: true } },
      'FURTHER_EVALUATION_RECOMMENDED',
      'ROUTINE',
    ),
    rule(
      'DEMO_R2',
      { answerIn: { question: 'DEMO_Q2', codes: ['DEMO_OPTION_C'] } },
      'FURTHER_EVALUATION_RECOMMENDED',
      null,
    ),
  ]),
  demoSet('D2', 'DEFICIENCIES', [
    rule(
      'DEMO_R1',
      {
        all: [
          { answerIs: { question: 'DEMO_Q1', value: true } },
          { answerIn: { question: 'DEMO_Q2', codes: ['DEMO_OPTION_A'] } },
        ],
      },
      'FURTHER_EVALUATION_RECOMMENDED',
      'ROUTINE',
    ),
    rule(
      'DEMO_R2',
      { answerNumber: { question: 'DEMO_Q3', op: 'gte', value: '900' } },
      'FURTHER_EVALUATION_RECOMMENDED',
      null,
    ),
  ]),
  demoSet('D3', 'DISEASES', [
    rule(
      'DEMO_R1',
      { answerIs: { question: 'DEMO_Q1', value: true } },
      'URGENT_EVALUATION_RECOMMENDED',
      'URGENT',
    ),
  ]),
  demoSet('D4', 'DEVELOPMENTAL_DELAYS_DISABILITIES', [
    rule(
      'DEMO_R1',
      {
        any: [
          { answerIs: { question: 'DEMO_Q1', value: true } },
          { answerIs: { question: 'DEMO_Q2', value: true } },
        ],
      },
      'FURTHER_EVALUATION_RECOMMENDED',
      'PRIORITY',
    ),
  ]),
];

/** Creates missing demonstration rule sets (DRAFT, no actor). Never changes an existing row. */
export async function ensureDemoRuleSets(db: PrismaClient): Promise<void> {
  for (const def of DEMO_RULE_SETS) await importRuleSet(db, def, null);
}
