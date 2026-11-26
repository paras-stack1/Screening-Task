import { z } from 'zod';
import { fourDCategorySchema, localizedTextSchema, protocolStatusSchema } from './screening.js';

/**
 * Parent Care content library (Step 8, stage 8B; docs/step-8/care-content-governance.md).
 *
 * Care content is DATA from an approved source (programme / clinical team, decision C2). This file
 * defines what a content item may contain; it contains no guidance. Videos and home activities are
 * versioned and approved like screening protocols and clinical rule sets, and change only through
 * the governed CLI (`db:care-content-import`, `db:care-content-status`).
 *
 * Safety rules built into the format:
 *  - every item names its source and the permission to use it;
 *  - frequencies ("daily", "3 times a week") are TEXT copied from the source - the software never
 *    computes a frequency, quantity or diet (decisions C5, C7);
 *  - "doctor-recommended" items are marked `requiresDoctor` - only a medical officer may assign
 *    them (decision C6, enforced from stage 8C);
 *  - videos are approved hosted links over HTTPS, streamed, never downloaded (decision C8);
 *  - demonstration placeholders point only at the reserved `.invalid` domain, so they can never
 *    play real media, and real content can never point there.
 */

export const CARE_CONTENT_DSL_VERSION = 1 as const;

export const CARE_CONTENT_KINDS = ['VIDEO', 'ACTIVITY'] as const;
export const careContentKindSchema = z.enum(CARE_CONTENT_KINDS);
export type CareContentKind = z.infer<typeof careContentKindSchema>;

/** Topic list from the Step 8 audit (decision C5; programme to confirm). */
export const CARE_CONTENT_TOPICS = [
  'DEVELOPMENT_MOTOR',
  'DEVELOPMENT_SPEECH_LANGUAGE',
  'DEVELOPMENT_SOCIAL_PLAY',
  'DEVELOPMENT_COGNITIVE',
  'NUTRITION_FEEDING',
  'HYGIENE',
  'DAILY_CARE',
] as const;
export const careContentTopicSchema = z.enum(CARE_CONTENT_TOPICS);
export type CareContentTopic = z.infer<typeof careContentTopicSchema>;

export const CARE_CONTENT_LANGUAGES = ['hi', 'en'] as const;

const contentCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'Codes are upper-case letters, digits and underscores');

const shortTextSchema = z.strictObject({
  hi: z.string().trim().min(1).max(200),
  en: z.string().trim().min(1).max(200),
});

/** Hosts reserved for documentation and tests (RFC 2606 / 6761): never real content. */
const RESERVED_HOST = /(^|\.)(invalid|test|example|localhost)$|(^|\.)example\.(com|net|org)$/;

/** Host of an https URL, lower-case; null when the text is not an https URL without credentials. */
export function careVideoHost(url: string): string | null {
  // Deliberately strict (no URL parser in every runtime): https, a plain DNS host name, optional
  // port, then a path / query / fragment. User info ("user@host"), IP literals and spaces fail.
  const match =
    /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,62}\.)*[a-z0-9-]{1,63})(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.exec(url);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  if (/^[\d.]+$/.test(host) || !host.includes('.')) return null;
  return host;
}

export const careVideoSchema = z.strictObject({
  /** Approved hosted link (official programme channel); HTTPS only. */
  url: z
    .string()
    .trim()
    .max(500)
    .refine((u) => careVideoHost(u) !== null, 'An https:// link without user name or password'),
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(4 * 60 * 60),
  /** Approximate download size of one playback, shown to the family before playing (data cost). */
  sizeBytes: z.number().int().min(1).max(2_000_000_000),
  /** Spoken languages. */
  languages: z.array(z.enum(CARE_CONTENT_LANGUAGES)).min(1).max(2),
  hasCaptions: z.boolean(),
});
export type CareVideo = z.infer<typeof careVideoSchema>;

/** A complete content item as supplied by the programme (import file format). */
export const careContentDefinitionSchema = z
  .strictObject({
    dslVersion: z.literal(CARE_CONTENT_DSL_VERSION),
    code: contentCodeSchema,
    version: z.number().int().min(1),
    kind: careContentKindSchema,
    topic: careContentTopicSchema,
    /** Optional Four-D category the item supports (for matching with review decisions later). */
    category: fourDCategorySchema.nullable(),
    title: shortTextSchema,
    summary: localizedTextSchema,
    /** Inclusive age band in completed days: the item is offered only to children of this age. */
    ageMinDays: z.number().int().min(0).max(7000),
    ageMaxDays: z.number().int().min(0).max(7000),
    /** ACTIVITY only: the steps the family follows, in order. */
    steps: z.array(localizedTextSchema).min(1).max(20).optional(),
    /** Frequency text exactly as the source suggests (ACTIVITY: required; VIDEO: optional). */
    suggestedFrequency: shortTextSchema.optional(),
    /** VIDEO only. */
    video: careVideoSchema.optional(),
    /** Doctor-recommended content: only a medical officer may put it on a plan (decision C6). */
    requiresDoctor: z.boolean(),
    /** Who made it: document / channel, edition, section. */
    sourceReference: z.string().trim().min(3).max(500),
    /** Licence or written permission to show it (reference to the document). */
    usagePermission: z.string().trim().min(3).max(500),
    isDemonstration: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.ageMaxDays < d.ageMinDays) {
      ctx.addIssue({ code: 'custom', message: 'ageMaxDays is below ageMinDays', path: ['ageMaxDays'] });
    }
    if (d.kind === 'ACTIVITY') {
      if (!d.steps) ctx.addIssue({ code: 'custom', message: 'An activity needs steps', path: ['steps'] });
      if (!d.suggestedFrequency) {
        ctx.addIssue({
          code: 'custom',
          message: 'An activity needs the frequency suggested by its source',
          path: ['suggestedFrequency'],
        });
      }
      if (d.video) ctx.addIssue({ code: 'custom', message: 'An activity has no video', path: ['video'] });
    }
    if (d.kind === 'VIDEO') {
      if (!d.video)
        ctx.addIssue({ code: 'custom', message: 'A video needs its video link', path: ['video'] });
      if (d.steps) ctx.addIssue({ code: 'custom', message: 'A video has no steps', path: ['steps'] });
    }
    if (d.video) {
      const host = careVideoHost(d.video.url);
      if (host !== null) {
        if (d.isDemonstration && !/(^|\.)invalid$/.test(host)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Demonstration videos must use the reserved .invalid domain',
            path: ['video', 'url'],
          });
        }
        if (!d.isDemonstration && RESERVED_HOST.test(host)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Real content cannot use a reserved or example domain',
            path: ['video', 'url'],
          });
        }
      }
      if (new Set(d.video.languages).size !== d.video.languages.length) {
        ctx.addIssue({ code: 'custom', message: 'Languages are listed twice', path: ['video', 'languages'] });
      }
    }
  });
export type CareContentDefinition = z.infer<typeof careContentDefinitionSchema>;

/** What is stored in CareContent.definition (the other fields are columns). */
export const storedCareContentSchema = z.strictObject({
  dslVersion: z.literal(CARE_CONTENT_DSL_VERSION),
  steps: z.array(localizedTextSchema).min(1).max(20).optional(),
  suggestedFrequency: shortTextSchema.optional(),
  video: careVideoSchema.optional(),
});
export type StoredCareContent = z.infer<typeof storedCareContentSchema>;

// ------------------------------------------------------------------ read API (workers, doctors)

export const careContentListQuerySchema = z.strictObject({
  kind: careContentKindSchema.optional(),
  topic: careContentTopicSchema.optional(),
  category: fourDCategorySchema.optional(),
  /** Only items whose age band contains this age (completed days). */
  ageDays: z.coerce.number().int().min(0).max(7000).optional(),
});
export type CareContentListQuery = z.infer<typeof careContentListQuerySchema>;

export const careContentSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  version: z.number(),
  kind: careContentKindSchema,
  topic: careContentTopicSchema,
  category: fourDCategorySchema.nullable(),
  title: shortTextSchema,
  summary: localizedTextSchema,
  ageMinDays: z.number(),
  ageMaxDays: z.number(),
  requiresDoctor: z.boolean(),
  sourceReference: z.string(),
  status: protocolStatusSchema,
  isDemonstration: z.boolean(),
  /** True only for ACTIVE, approved, non-demonstration content. */
  isClinicallyApproved: z.boolean(),
  approvalReference: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  /** Length and data cost, shown before playing; null for activities. */
  video: z
    .object({
      durationSeconds: z.number(),
      sizeBytes: z.number(),
      languages: z.array(z.enum(CARE_CONTENT_LANGUAGES)),
      hasCaptions: z.boolean(),
    })
    .nullable(),
});
export type CareContentSummary = z.infer<typeof careContentSummarySchema>;

export const careContentDetailSchema = careContentSummarySchema.extend({
  usagePermission: z.string(),
  contentSha256: z.string().nullable(),
  steps: z.array(localizedTextSchema),
  suggestedFrequency: shortTextSchema.nullable(),
  videoUrl: z.string().nullable(),
});
export type CareContentDetail = z.infer<typeof careContentDetailSchema>;

export const careContentListResponseSchema = z.object({ items: z.array(careContentSummarySchema) });
export type CareContentListResponse = z.infer<typeof careContentListResponseSchema>;

export const careContentDetailResponseSchema = z.object({ content: careContentDetailSchema });
export type CareContentDetailResponse = z.infer<typeof careContentDetailResponseSchema>;
