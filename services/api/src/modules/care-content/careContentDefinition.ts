import { createHash } from 'node:crypto';
import {
  careContentDefinitionSchema,
  storedCareContentSchema,
  type CareContentDefinition,
} from '@balswasthya/shared-contracts';
import type { CareContent, Prisma } from '@prisma/client';
import { canonicalJson } from '../clinical-rules/ruleSetContent';

/**
 * Care content identity (Step 8B). The SHA-256 of the canonical definition is fixed when an item
 * leaves DRAFT; reviewers approve exactly that hash, and the read API refuses to serve approved
 * content whose stored text no longer matches it.
 */
export function careContentHash(def: CareContentDefinition): string {
  return createHash('sha256').update(canonicalJson(def)).digest('hex');
}

/** Rebuilds and RE-VALIDATES the definition from a row (invalid stored content throws). */
export function careContentRowToDefinition(row: CareContent): CareContentDefinition {
  const stored = storedCareContentSchema.parse(row.definition);
  return careContentDefinitionSchema.parse({
    dslVersion: stored.dslVersion,
    code: row.code,
    version: row.version,
    kind: row.kind,
    topic: row.topic,
    category: row.category,
    title: { hi: row.titleHi, en: row.titleEn },
    summary: { hi: row.summaryHi, en: row.summaryEn },
    ageMinDays: row.ageMinDays,
    ageMaxDays: row.ageMaxDays,
    ...(stored.steps ? { steps: stored.steps } : {}),
    ...(stored.suggestedFrequency ? { suggestedFrequency: stored.suggestedFrequency } : {}),
    ...(stored.video ? { video: stored.video } : {}),
    requiresDoctor: row.requiresDoctor,
    sourceReference: row.sourceReference,
    usagePermission: row.usagePermission,
    isDemonstration: row.isDemonstration,
  });
}

export function careContentCreateInput(
  def: CareContentDefinition,
  createdById: string | null,
): Prisma.CareContentUncheckedCreateInput {
  return {
    code: def.code,
    version: def.version,
    kind: def.kind,
    topic: def.topic,
    category: def.category,
    titleEn: def.title.en,
    titleHi: def.title.hi,
    summaryEn: def.summary.en,
    summaryHi: def.summary.hi,
    ageMinDays: def.ageMinDays,
    ageMaxDays: def.ageMaxDays,
    requiresDoctor: def.requiresDoctor,
    sourceReference: def.sourceReference,
    usagePermission: def.usagePermission,
    definition: {
      dslVersion: def.dslVersion,
      ...(def.steps ? { steps: def.steps } : {}),
      ...(def.suggestedFrequency ? { suggestedFrequency: def.suggestedFrequency } : {}),
      ...(def.video ? { video: def.video } : {}),
    },
    isDemonstration: def.isDemonstration,
    createdById,
  };
}
