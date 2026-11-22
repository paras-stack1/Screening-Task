import { createHash } from 'node:crypto';
import {
  choiceOptionSchema,
  localizedTextSchema,
  protocolDefinitionSchema,
  questionValidationSchema,
  type LocalizedText,
  type ProtocolDefinition,
  type QuestionValidation,
} from '@balswasthya/shared-contracts';
import type { Prisma, ScreeningProtocol, ScreeningQuestion } from '@prisma/client';
import { z } from 'zod';

/**
 * Protocol content identity (Step 6 decisions C, D). The SHA-256 of the canonical content is
 * fixed when a protocol leaves DRAFT; reviewers approve exactly that hash, and the API re-checks
 * it before using an approved protocol, so content that changed outside the governed process is
 * detected rather than silently used.
 *
 * The canonical form is built field by field (fixed key order, questions sorted by sortOrder then
 * code, absent values as null), so the same content always produces the same hash.
 */

const text = (t: LocalizedText) => ({ hi: t.hi, en: t.en });

function canonicalValidation(v: QuestionValidation | undefined) {
  if (!v) return null;
  return {
    min: v.min ?? null,
    max: v.max ?? null,
    maxDecimals: v.maxDecimals ?? null,
    unit: v.unit ?? null,
    maxLength: v.maxLength ?? null,
  };
}

export function canonicalProtocolContent(def: ProtocolDefinition) {
  const questions = [...def.questions].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );
  return {
    code: def.code,
    version: def.version,
    category: def.category,
    name: text(def.name),
    description: def.description ? text(def.description) : null,
    ageMinDays: def.ageMinDays,
    ageMaxDays: def.ageMaxDays,
    sourceReference: def.sourceReference,
    isDemonstration: def.isDemonstration,
    questions: questions.map((q) => ({
      code: q.code,
      sectionCode: q.sectionCode,
      sortOrder: q.sortOrder,
      prompt: text(q.prompt),
      help: q.help ? text(q.help) : null,
      answerType: q.answerType,
      options: q.options ? q.options.map((o) => ({ code: o.code, label: text(o.label) })) : null,
      validation: canonicalValidation(q.validation),
      isRequired: q.isRequired,
    })),
  };
}

export function protocolContentHash(def: ProtocolDefinition): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalProtocolContent(def)), 'utf8')
    .digest('hex');
}

export type ProtocolWithQuestions = ScreeningProtocol & { questions: ScreeningQuestion[] };

const optionsSchema = z.array(choiceOptionSchema);

/**
 * Rebuilds the definition from stored rows and validates it. Throws if stored content is not a
 * valid protocol (e.g. edited directly in the database) - such content is never served.
 */
export function protocolRowToDefinition(row: ProtocolWithQuestions): ProtocolDefinition {
  const description =
    row.descriptionEn !== null && row.descriptionHi !== null
      ? { hi: row.descriptionHi, en: row.descriptionEn }
      : undefined;
  return protocolDefinitionSchema.parse({
    code: row.code,
    version: row.version,
    category: row.category,
    name: { hi: row.nameHi, en: row.nameEn },
    ...(description ? { description } : {}),
    ageMinDays: row.ageMinDays,
    ageMaxDays: row.ageMaxDays,
    sourceReference: row.sourceReference,
    isDemonstration: row.isDemonstration,
    questions: row.questions.map((q) => ({
      code: q.code,
      sectionCode: q.sectionCode,
      sortOrder: q.sortOrder,
      prompt: localizedTextSchema.parse(q.prompt),
      ...(q.help !== null ? { help: localizedTextSchema.parse(q.help) } : {}),
      answerType: q.answerType,
      ...(q.options !== null ? { options: optionsSchema.parse(q.options) } : {}),
      ...(q.validation !== null ? { validation: questionValidationSchema.parse(q.validation) } : {}),
      isRequired: q.isRequired,
    })),
  });
}

/** Prisma create input for a protocol version and its questions (always created as DRAFT). */
export function definitionToCreateInput(def: ProtocolDefinition): Prisma.ScreeningProtocolCreateInput {
  return {
    code: def.code,
    version: def.version,
    category: def.category,
    nameEn: def.name.en,
    nameHi: def.name.hi,
    descriptionEn: def.description?.en ?? null,
    descriptionHi: def.description?.hi ?? null,
    ageMinDays: def.ageMinDays,
    ageMaxDays: def.ageMaxDays,
    sourceReference: def.sourceReference,
    isDemonstration: def.isDemonstration,
    status: 'DRAFT',
    questions: {
      create: def.questions.map((q) => ({
        code: q.code,
        category: def.category,
        sectionCode: q.sectionCode,
        sortOrder: q.sortOrder,
        promptKey: `${def.code}.${q.code}`,
        helpKey: q.help ? `${def.code}.${q.code}.help` : null,
        prompt: text(q.prompt),
        ...(q.help ? { help: text(q.help) } : {}),
        answerType: q.answerType,
        ...(q.options ? { options: q.options.map((o) => ({ code: o.code, label: text(o.label) })) } : {}),
        // Stored with only the keys that are set (the schema rejects nulls).
        ...(q.validation ? { validation: { ...q.validation } } : {}),
        isRequired: q.isRequired,
      })),
    },
  };
}
