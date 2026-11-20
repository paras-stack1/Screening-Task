import { z } from 'zod';

/** Languages supported by the product from day one. */
export const SUPPORTED_LANGUAGES = ['en', 'hi'] as const;
export const supportedLanguageSchema = z.enum(SUPPORTED_LANGUAGES);
export type SupportedLanguage = z.infer<typeof supportedLanguageSchema>;

/** Standard error envelope returned by every API error response. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Optional field-level validation details. Never contains secrets or PII. */
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
