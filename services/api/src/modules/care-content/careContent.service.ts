import type {
  CareContentDefinition,
  CareContentDetail,
  CareContentListQuery,
  CareContentListResponse,
  CareContentSummary,
} from '@balswasthya/shared-contracts';
import type { CareContent, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import type { ScreeningPolicySettings } from '../screening/protocolSelection';
import { careContentHash, careContentRowToDefinition } from './careContentDefinition';

export interface CareContentServiceDependencies {
  db: PrismaClient;
  /** Draft (incl. demonstration) content is offered only where draft protocols are allowed. */
  screeningPolicy: ScreeningPolicySettings;
}

/**
 * Validated definition of a row, or null when its stored content is invalid or no longer matches
 * the reviewed hash. Such content is never served - it is logged for investigation instead.
 */
function trustedDefinition(row: CareContent): CareContentDefinition | null {
  let def: CareContentDefinition;
  try {
    def = careContentRowToDefinition(row);
  } catch {
    logger.error('care_content_definition_invalid', { contentId: row.id });
    return null;
  }
  if (row.contentSha256 !== null && careContentHash(def) !== row.contentSha256) {
    logger.error('care_content_content_mismatch', { contentId: row.id });
    return null;
  }
  return def;
}

function toSummary(row: CareContent, def: CareContentDefinition): CareContentSummary {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    kind: row.kind,
    topic: row.topic,
    category: row.category,
    title: def.title,
    summary: def.summary,
    ageMinDays: row.ageMinDays,
    ageMaxDays: row.ageMaxDays,
    requiresDoctor: row.requiresDoctor,
    sourceReference: row.sourceReference,
    status: row.status,
    isDemonstration: row.isDemonstration,
    isClinicallyApproved: row.status === 'ACTIVE' && !row.isDemonstration && row.approvedAt !== null,
    approvalReference: row.approvalReference,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    video: def.video
      ? {
          durationSeconds: def.video.durationSeconds,
          sizeBytes: def.video.sizeBytes,
          languages: def.video.languages,
          hasCaptions: def.video.hasCaptions,
        }
      : null,
  };
}

/**
 * Care content library, read-only (Step 8B). There is no API to create, edit or approve content:
 * changes go through the governed CLI (docs/step-8/care-content-governance.md). Content is not
 * personal data, but unapproved drafts are hidden wherever draft content is not allowed
 * (production), so they can never be mistaken for approved guidance.
 */
export function createCareContentService({ db, screeningPolicy }: CareContentServiceDependencies) {
  const allowDraft = screeningPolicy.allowDraftProtocols;

  return {
    /**
     * Content a worker may offer today: per code, the ACTIVE version once its effective date is
     * reached; where drafts are allowed and no version is ACTIVE, the highest DRAFT version.
     */
    async listOffered(query: CareContentListQuery, at: Date): Promise<CareContentListResponse> {
      const where: Prisma.CareContentWhereInput = {
        status: { in: allowDraft ? ['ACTIVE', 'DRAFT'] : ['ACTIVE'] },
        ...(query.kind && { kind: query.kind }),
        ...(query.topic && { topic: query.topic }),
        ...(query.category && { category: query.category }),
        ...(query.ageDays !== undefined && {
          ageMinDays: { lte: query.ageDays },
          ageMaxDays: { gte: query.ageDays },
        }),
      };
      const rows = await db.careContent.findMany({
        where,
        orderBy: [{ topic: 'asc' }, { code: 'asc' }, { version: 'desc' }],
        take: 500,
      });
      const chosen = new Map<string, CareContent>();
      for (const row of rows) {
        if (row.status === 'ACTIVE' && (!row.effectiveFrom || row.effectiveFrom > at)) continue;
        const current = chosen.get(row.code);
        // ACTIVE beats any draft; among drafts the highest version wins (rows are version-desc).
        if (!current || (row.status === 'ACTIVE' && current.status !== 'ACTIVE')) chosen.set(row.code, row);
      }
      const items: CareContentSummary[] = [];
      for (const row of chosen.values()) {
        const def = trustedDefinition(row);
        if (def) items.push(toSummary(row, def));
      }
      return { items };
    },

    /** One version with its steps / video link. Drafts only where drafts are allowed. */
    async get(id: string): Promise<{ content: CareContentDetail }> {
      const row = await db.careContent.findFirst({
        where: {
          id,
          ...(allowDraft ? {} : { status: { in: ['APPROVED', 'ACTIVE', 'RETIRED'] } }),
        },
      });
      const def = row ? trustedDefinition(row) : null;
      if (!row || !def) throw AppError.notFound('Care content not found');
      return {
        content: {
          ...toSummary(row, def),
          usagePermission: row.usagePermission,
          contentSha256: row.contentSha256,
          steps: def.steps ?? [],
          suggestedFrequency: def.suggestedFrequency ?? null,
          videoUrl: def.video?.url ?? null,
        },
      };
    },
  };
}
