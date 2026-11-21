import { z } from 'zod';

/**
 * Validation shared by child and guardian contracts (Step 5). Used by the API (authoritative)
 * and by the worker app (early feedback only).
 */

/** Collapses whitespace and applies Unicode NFC so the same name is stored one way. */
export function cleanPersonName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Letters and combining marks of any script (Hindi matras, nukta), spaces, . ' - */
const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

export const personNameSchema = z
  .string()
  .transform(cleanPersonName)
  .pipe(
    z
      .string()
      .min(2, 'Name must have at least 2 characters')
      .max(100, 'Name must have at most 100 characters')
      .regex(PERSON_NAME, "Name may contain only letters, spaces and . ' -"),
  );

/**
 * Indian mobile numbers only (decision F). Accepts common spellings (spaces, hyphens, leading 0,
 * 91 or +91) and returns "+91XXXXXXXXXX", or null if the value is not a valid Indian mobile.
 */
export function normalizeIndianMobile(value: string): string | null {
  const compact = value.replace(/[\s\-().]/g, '');
  const match = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(compact);
  return match ? `+91${match[1]}` : null;
}

export const indianMobileSchema = z
  .string()
  .max(20)
  .transform((value, ctx) => {
    const normalized = normalizeIndianMobile(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return normalized;
  });

/** "+91 ••••••3210": the only form in which a phone number appears outside the guardian view. */
export function maskIndianMobile(normalized: string): string {
  return `+91 ••••••${normalized.slice(-4)}`;
}

export const preferredLanguageSchema = z.enum(['hi', 'en']);

/** Calendar date "YYYY-MM-DD" (validated as a real date by the consumers). */
export const isoCalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

/** Optimistic concurrency token: the record's updatedAt as last read by the client (decision R). */
export const expectedUpdatedAtSchema = z.iso.datetime({ offset: true });

/** Short operational reason. Must not contain personal data (stated in the UI). */
export const shortReasonSchema = z.string().trim().min(3).max(200);
