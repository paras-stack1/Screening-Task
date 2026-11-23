import { z } from 'zod';

/**
 * Client-side checks for quick feedback only; the API validates everything again and is the
 * authority. Messages are translation keys, rendered with t() by the form.
 */
export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_CHARS = 128;
const LOGIN_ID_MAX = 64;
const PASSWORD_INPUT_MAX = 1024;

/** Counts characters like the server (NFKC, code points), so Hindi passwords count fairly. */
export function passwordCharCount(password: string): number {
  return Array.from(password.normalize('NFKC')).length;
}

export const loginFormSchema = z.object({
  loginId: z
    .string()
    .trim()
    .min(1, 'login.errors.loginIdRequired')
    .max(LOGIN_ID_MAX, 'login.errors.loginIdTooLong'),
  // Not trimmed: spaces may be part of a password.
  password: z
    .string()
    .min(1, 'login.errors.passwordRequired')
    .max(PASSWORD_INPUT_MAX, 'login.errors.passwordTooLong'),
});
export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const changePasswordFormSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'changePassword.errors.currentRequired')
      .max(PASSWORD_INPUT_MAX, 'login.errors.passwordTooLong'),
    newPassword: z
      .string()
      .refine((value) => passwordCharCount(value) >= PASSWORD_MIN_CHARS, 'changePassword.errors.tooShort')
      .refine((value) => passwordCharCount(value) <= PASSWORD_MAX_CHARS, 'changePassword.errors.tooLong'),
    confirmPassword: z.string(),
  })
  .superRefine((values, context) => {
    if (values.confirmPassword !== values.newPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'changePassword.errors.mismatch',
      });
    }
    if (values.newPassword && values.newPassword === values.currentPassword) {
      context.addIssue({
        code: 'custom',
        path: ['newPassword'],
        message: 'changePassword.errors.sameAsCurrent',
      });
    }
  });
export type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;
