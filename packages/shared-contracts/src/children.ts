import { z } from 'zod';
import { CHILD_MAX_AGE_YEARS } from './dates.js';
import {
  expectedUpdatedAtSchema,
  indianMobileSchema,
  isoCalendarDateSchema,
  personNameSchema,
  preferredLanguageSchema,
} from './people.js';

/**
 * Child registration, profile and guardian-link contracts (Step 5; docs/api/children.md).
 * Every request schema is strict: creator ids, timestamps, status and area changes cannot be
 * supplied by a client (mass-assignment protection).
 */

// ----------------------------------------------------------------------------- enums

/** Illustrative programme options (schema enum). Omitted in a request = NOT_RECORDED (decision D). */
export const SEX_AT_BIRTH = ['FEMALE', 'MALE', 'OTHER', 'NOT_RECORDED'] as const;
export const sexAtBirthSchema = z.enum(SEX_AT_BIRTH);
export type SexAtBirth = z.infer<typeof sexAtBirthSchema>;

export const GUARDIAN_RELATIONSHIPS = [
  'MOTHER',
  'FATHER',
  'GRANDPARENT',
  'SIBLING',
  'OTHER_RELATIVE',
  'LEGAL_GUARDIAN',
  'INSTITUTION_CARETAKER',
  'OTHER',
] as const;
export const guardianRelationshipSchema = z.enum(GUARDIAN_RELATIONSHIPS);
export type GuardianRelationship = z.infer<typeof guardianRelationshipSchema>;

// ------------------------------------------------------------------------ birth input

/** Used when the date of birth is unknown (decision C). The API derives an estimated date. */
export const ageEstimateSchema = z.strictObject({
  years: z.number().int().min(0).max(CHILD_MAX_AGE_YEARS),
  months: z.number().int().min(0).max(11),
});
export type AgeEstimate = z.infer<typeof ageEstimateSchema>;

// ------------------------------------------------------------------------ guardian input

export const newGuardianSchema = z.strictObject({
  fullName: personNameSchema,
  /** Optional (decision F). Never required to prove guardianship. */
  phone: indianMobileSchema.optional(),
  preferredLanguage: preferredLanguageSchema.default('hi'),
});
export type NewGuardian = z.input<typeof newGuardianSchema>;

/**
 * Link one guardian: either an existing guardian (already linked to a child the worker may
 * access, e.g. a sibling) or a new one - never both.
 */
export const guardianLinkBaseSchema = z.strictObject({
  existingGuardianId: z.uuid().optional(),
  newGuardian: newGuardianSchema.optional(),
  relationship: guardianRelationshipSchema,
  isPrimaryContact: z.boolean().default(false),
  /** Required with no default (decision L): the worker must answer explicitly. */
  canGiveConsent: z.boolean(),
  /** Set after the worker has reviewed a possible-duplicate-guardian warning. */
  confirmNewGuardian: z.boolean().default(false),
});

export const exactlyOneGuardianSource: [
  (v: { existingGuardianId?: string | undefined; newGuardian?: unknown }) => boolean,
  { message: string; path: PropertyKey[] },
] = [
  (v) => (v.existingGuardianId === undefined) !== (v.newGuardian === undefined),
  { message: 'Provide either existingGuardianId or newGuardian', path: ['existingGuardianId'] },
];

export const guardianLinkInputSchema = guardianLinkBaseSchema.refine(...exactlyOneGuardianSource);
export type GuardianLinkInput = z.input<typeof guardianLinkInputSchema>;

// ------------------------------------------------------------------------ registration

export const registerChildRequestSchema = z
  .strictObject({
    /** Client-generated per submission; a retry with the same id returns the first result. */
    clientOperationId: z.uuid(),
    fullName: personNameSchema,
    dateOfBirth: isoCalendarDateSchema.optional(),
    ageEstimate: ageEstimateSchema.optional(),
    sexAtBirth: sexAtBirthSchema.optional(),
    areaId: z.uuid(),
    guardians: z.array(guardianLinkInputSchema).min(1).max(4),
    /** Set after the worker has reviewed a possible-duplicate-child warning. */
    confirmNotDuplicate: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if ((value.dateOfBirth === undefined) === (value.ageEstimate === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateOfBirth'],
        message: 'Provide either dateOfBirth or ageEstimate',
      });
    }
    if (value.guardians.filter((g) => g.isPrimaryContact).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['guardians'], message: 'Only one primary contact is allowed' });
    }
    const existing = value.guardians.map((g) => g.existingGuardianId).filter(Boolean);
    if (new Set(existing).size !== existing.length) {
      ctx.addIssue({ code: 'custom', path: ['guardians'], message: 'A guardian is listed twice' });
    }
  });
export type RegisterChildRequest = z.input<typeof registerChildRequestSchema>;

/** Child fields that may be corrected. Area changes need the (future) transfer workflow (decision O). */
export const updateChildRequestSchema = z
  .strictObject({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    fullName: personNameSchema.optional(),
    dateOfBirth: isoCalendarDateSchema.optional(),
    ageEstimate: ageEstimateSchema.optional(),
    sexAtBirth: sexAtBirthSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dateOfBirth !== undefined && value.ageEstimate !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateOfBirth'],
        message: 'Provide dateOfBirth or ageEstimate, not both',
      });
    }
    if (
      value.fullName === undefined &&
      value.dateOfBirth === undefined &&
      value.ageEstimate === undefined &&
      value.sexAtBirth === undefined
    ) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Nothing to update' });
    }
  });
export type UpdateChildRequest = z.input<typeof updateChildRequestSchema>;

// ------------------------------------------------------------------------ list / search

export const CHILD_SORTS = [
  'fullName',
  '-fullName',
  'dateOfBirth',
  '-dateOfBirth',
  'createdAt',
  '-createdAt',
] as const;

/** Strict: unknown query parameters are rejected. Sorting is an allowlist, never a raw column. */
export const childListQuerySchema = z.strictObject({
  search: z.string().trim().min(2).max(50).optional(),
  /** Narrows the list to this area and its sub-areas - always WITHIN the caller's scope. */
  areaId: z.uuid().optional(),
  /** Registration date range (calendar dates in India, inclusive). */
  registeredFrom: isoCalendarDateSchema.optional(),
  registeredTo: isoCalendarDateSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(CHILD_SORTS).default('fullName'),
});
export type ChildListQuery = z.infer<typeof childListQuerySchema>;

// ------------------------------------------------------------------------ responses

export const childSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
  /** Calendar date, YYYY-MM-DD. When dobIsEstimated, show an approximate age, not this date. */
  dateOfBirth: z.string(),
  dobIsEstimated: z.boolean(),
  sexAtBirth: z.string(),
  areaId: z.string(),
  areaName: z.string(),
  areaNameHi: z.string().nullable(),
  /** ISO timestamp of registration (server time). */
  registeredAt: z.string(),
});
export type ChildSummary = z.infer<typeof childSummarySchema>;

export const childListResponseSchema = z.object({
  items: z.array(childSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  /** Number of matching children in the caller's scope only. */
  total: z.number(),
});
export type ChildListResponse = z.infer<typeof childListResponseSchema>;

/** A child-guardian link as seen from the child. Phone numbers are masked here (decision F). */
export const guardianLinkSchema = z.object({
  relationshipId: z.string(),
  guardianId: z.string(),
  fullName: z.string(),
  relationship: z.string(),
  isPrimaryContact: z.boolean(),
  canGiveConsent: z.boolean(),
  phoneMasked: z.string().nullable(),
  preferredLanguage: z.string(),
  linkedAt: z.string(),
  /** Set for ended links (only listed with includeEnded=true). */
  endedAt: z.string().nullable(),
});
export type GuardianLink = z.infer<typeof guardianLinkSchema>;

export const childDetailSchema = childSummarySchema.extend({
  /** Concurrency token for updates (decision R). */
  updatedAt: z.string(),
  registeredByName: z.string(),
  /** Current (not ended) guardian links. */
  guardians: z.array(guardianLinkSchema),
});
export type ChildDetail = z.infer<typeof childDetailSchema>;

export const childDetailResponseSchema = z.object({ child: childDetailSchema });
export type ChildDetailResponse = z.infer<typeof childDetailResponseSchema>;

// ------------------------------------------------------------------------ duplicate warnings

/**
 * SIMILAR_NAME_AND_BIRTH: similar name, close date of birth, same registration area.
 * SHARED_GUARDIAN: linked to the same guardian (chosen existing guardian or same phone number)
 * with a date of birth within about a month - a possible duplicate, or a twin.
 */
export const DUPLICATE_REASONS = ['SIMILAR_NAME_AND_BIRTH', 'SHARED_GUARDIAN'] as const;

/**
 * Details of a 409 POSSIBLE_DUPLICATE response. Only children the worker can already access are
 * ever listed; matches outside the worker's scope are never mentioned (decision G).
 */
export const duplicateChildDetailsSchema = z.object({
  candidates: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
      dateOfBirth: z.string(),
      dobIsEstimated: z.boolean(),
      areaName: z.string(),
      areaNameHi: z.string().nullable(),
      reasons: z.array(z.enum(DUPLICATE_REASONS)),
    }),
  ),
});
export type DuplicateChildDetails = z.infer<typeof duplicateChildDetailsSchema>;

/** Details of a 409 POSSIBLE_DUPLICATE_GUARDIAN response (in-scope guardians only). */
export const duplicateGuardianDetailsSchema = z.object({
  /** Index in the request's guardians array (0 for single-link requests). */
  guardianIndex: z.number(),
  candidates: z.array(z.object({ guardianId: z.string(), fullName: z.string(), phoneMasked: z.string() })),
});
export type DuplicateGuardianDetails = z.infer<typeof duplicateGuardianDetailsSchema>;

// ------------------------------------------------------------------------ registration areas

export const registrationAreaQuerySchema = z.strictObject({
  search: z.string().trim().min(1).max(50).optional(),
});
export type RegistrationAreaQuery = z.infer<typeof registrationAreaQuerySchema>;

export const registrationAreasResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      nameEn: z.string(),
      nameHi: z.string().nullable(),
      levelNameEn: z.string(),
      levelNameHi: z.string(),
      parentNameEn: z.string().nullable(),
      parentNameHi: z.string().nullable(),
    }),
  ),
  /** True when more areas match than were returned; narrow with `search`. */
  truncated: z.boolean(),
});
export type RegistrationAreasResponse = z.infer<typeof registrationAreasResponseSchema>;
