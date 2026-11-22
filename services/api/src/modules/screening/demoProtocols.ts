import {
  CHILD_MAX_AGE_YEARS,
  protocolDefinitionSchema,
  type AnswerType,
  type FourDCategoryCode,
  type ProtocolDefinition,
  type ProtocolQuestionDefinition,
} from '@balswasthya/shared-contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import { definitionToCreateInput, protocolContentHash, protocolRowToDefinition } from './protocolContent';

/**
 * DEMONSTRATION PROTOCOLS (Step 6 decision F).
 *
 * !!! NONE OF THIS IS CLINICAL CONTENT. !!!
 * These protocols exist only so the screening workflow can be built and tested before the
 * programme supplies clinically approved questions. Every question is a numbered placeholder with
 * no medical meaning. They:
 *  - are stored as DRAFT with isDemonstration = true, which the database refuses to approve;
 *  - cover the whole registration age range in ONE band, so no age band is invented;
 *  - are usable only where draft protocols are allowed (never in production);
 *  - make the app show "Demonstration content - not for clinical use" on every screening screen.
 * Real content is added as new protocol codes through the governed review process
 * (docs/step-6/clinical-content-governance.md), never by editing this file.
 */

/** Whole registration range: up to CHILD_MAX_AGE_YEARS completed years (+1 year, leap-safe). */
export const DEMO_AGE_MAX_DAYS = (CHILD_MAX_AGE_YEARS + 1) * 366;

const SOURCE = 'NONE - engineering demonstration content; not based on any clinical guideline';

const CATEGORY_NAMES: Record<FourDCategoryCode, { en: string; hi: string; short: string }> = {
  DEFECTS_AT_BIRTH: { en: 'Defects at birth', hi: 'जन्म के समय दोष', short: 'D1' },
  DEFICIENCIES: { en: 'Deficiencies', hi: 'कमियाँ', short: 'D2' },
  DISEASES: { en: 'Diseases', hi: 'बीमारियाँ', short: 'D3' },
  DEVELOPMENTAL_DELAYS_DISABILITIES: {
    en: 'Developmental delays and disabilities',
    hi: 'विकास में देरी और दिव्यांगता',
    short: 'D4',
  },
};

const TYPE_LABEL: Record<AnswerType, { en: string; hi: string }> = {
  YES_NO: { en: 'yes / no', hi: 'हाँ / नहीं' },
  SINGLE_CHOICE: { en: 'choose one', hi: 'एक चुनें' },
  MULTI_CHOICE: { en: 'choose any', hi: 'कोई भी चुनें' },
  NUMBER: { en: 'number', hi: 'संख्या' },
  TEXT: { en: 'short text', hi: 'छोटा पाठ' },
};

const DEMO_OPTIONS = ['A', 'B', 'C'].map((letter) => ({
  code: `DEMO_OPTION_${letter}`,
  label: { en: `Demonstration option ${letter}`, hi: `प्रदर्शन विकल्प ${letter}` },
}));

type Spec = [section: 'DEMO_SECTION_A' | 'DEMO_SECTION_B', type: AnswerType, required: boolean];

/** Question shapes per category: exercises every answer type and two sections. */
const SPECS: Record<FourDCategoryCode, Spec[]> = {
  DEFECTS_AT_BIRTH: [
    ['DEMO_SECTION_A', 'YES_NO', true],
    ['DEMO_SECTION_A', 'SINGLE_CHOICE', true],
    ['DEMO_SECTION_B', 'TEXT', false],
  ],
  DEFICIENCIES: [
    ['DEMO_SECTION_A', 'YES_NO', true],
    ['DEMO_SECTION_A', 'MULTI_CHOICE', false],
    ['DEMO_SECTION_B', 'NUMBER', false],
  ],
  DISEASES: [
    ['DEMO_SECTION_A', 'YES_NO', true],
    ['DEMO_SECTION_A', 'NUMBER', false],
    ['DEMO_SECTION_B', 'TEXT', false],
  ],
  DEVELOPMENTAL_DELAYS_DISABILITIES: [
    ['DEMO_SECTION_A', 'YES_NO', true],
    ['DEMO_SECTION_A', 'YES_NO', true],
    ['DEMO_SECTION_B', 'SINGLE_CHOICE', false],
  ],
};

function demoQuestion(
  index: number,
  [sectionCode, answerType, isRequired]: Spec,
): ProtocolQuestionDefinition {
  const n = index + 1;
  const label = TYPE_LABEL[answerType];
  return {
    code: `DEMO_Q${n}`,
    sectionCode,
    sortOrder: n * 10,
    prompt: {
      en: `Demonstration question ${n} (${label.en}). Placeholder - not a clinical question.`,
      hi: `प्रदर्शन प्रश्न ${n} (${label.hi})। अस्थायी - यह चिकित्सकीय प्रश्न नहीं है।`,
    },
    answerType,
    ...(answerType === 'SINGLE_CHOICE' || answerType === 'MULTI_CHOICE' ? { options: DEMO_OPTIONS } : {}),
    // Data-entry rules for the placeholder only (no clinical meaning).
    ...(answerType === 'NUMBER' ? { validation: { min: 0, max: 999, maxDecimals: 0 } } : {}),
    ...(answerType === 'TEXT' ? { validation: { maxLength: 500 } } : {}),
    isRequired,
  };
}

function demoProtocol(category: FourDCategoryCode): ProtocolDefinition {
  const names = CATEGORY_NAMES[category];
  return protocolDefinitionSchema.parse({
    code: `DEMO_${names.short}`,
    version: 1,
    category,
    name: {
      en: `Demonstration - ${names.en} (not clinically approved)`,
      hi: `प्रदर्शन - ${names.hi} (चिकित्सकीय रूप से स्वीकृत नहीं)`,
    },
    description: {
      en: 'Placeholder content for testing the app. Not for use with children.',
      hi: 'ऐप की जाँच के लिए अस्थायी सामग्री। बच्चों के साथ उपयोग के लिए नहीं।',
    },
    ageMinDays: 0,
    ageMaxDays: DEMO_AGE_MAX_DAYS,
    sourceReference: SOURCE,
    isDemonstration: true,
    questions: SPECS[category].map((spec, i) => demoQuestion(i, spec)),
  });
}

export const DEMO_PROTOCOLS: readonly ProtocolDefinition[] = (
  ['DEFECTS_AT_BIRTH', 'DEFICIENCIES', 'DISEASES', 'DEVELOPMENTAL_DELAYS_DISABILITIES'] as const
).map(demoProtocol);

/**
 * Creates missing demonstration protocols (as DRAFT). Never changes an existing row. Returns the
 * protocols whose stored content differs from this file (drift: investigate, never auto-fix).
 */
export async function ensureDemoProtocols(db: PrismaClient | Prisma.TransactionClient): Promise<string[]> {
  const drift: string[] = [];
  for (const def of DEMO_PROTOCOLS) {
    const existing = await db.screeningProtocol.findUnique({
      where: { code_version: { code: def.code, version: def.version } },
      include: { questions: true },
    });
    if (!existing) {
      await db.screeningProtocol.create({ data: definitionToCreateInput(def) });
    } else if (protocolContentHash(protocolRowToDefinition(existing)) !== protocolContentHash(def)) {
      drift.push(`${def.code} v${def.version}`);
    }
  }
  return drift;
}
