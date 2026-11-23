import { z } from 'zod';

/**
 * Form checks for quick feedback (the API validates again and is the authority).
 * Messages are translation keys.
 */
const LOGIN_ID_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,63}$/;

/** Same normalisation as the API (NFKC, trimmed, upper case). */
export function normalizeLoginId(raw: string): string {
  return raw.normalize('NFKC').trim().toUpperCase();
}

export const reasonField = (requiredKey: string, tooLongKey: string) =>
  z.string().trim().min(3, requiredKey).max(500, tooLongKey);

export const createUserFormSchema = z.object({
  loginId: z
    .string()
    .transform(normalizeLoginId)
    .pipe(
      z
        .string()
        .min(3, 'create.errors.loginIdRequired')
        .max(64, 'create.errors.loginIdFormat')
        .regex(LOGIN_ID_PATTERN, 'create.errors.loginIdFormat'),
    ),
  displayName: z
    .string()
    .trim()
    .min(2, 'create.errors.displayNameRequired')
    .max(100, 'create.errors.displayNameTooLong'),
  preferredLanguage: z.enum(['hi', 'en']),
  roleId: z.string().min(1, 'create.errors.roleRequired'),
  areaId: z.string().min(1, 'create.errors.areaRequired'),
  scope: z.enum(['AREA_ONLY', 'AREA_AND_DESCENDANTS']),
  reason: reasonField('create.errors.reasonRequired', 'create.errors.reasonTooLong'),
});
export type CreateUserFormInput = z.input<typeof createUserFormSchema>;
export type CreateUserFormValues = z.output<typeof createUserFormSchema>;

export const reasonFormSchema = z.object({
  reason: reasonField('action.errors.reasonRequired', 'action.errors.reasonTooLong'),
});
export type ReasonFormValues = z.infer<typeof reasonFormSchema>;
