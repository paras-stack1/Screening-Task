import { z } from 'zod';
import { effectiveAccessSchema } from './users.js';

/**
 * Authentication contracts (docs/authentication.md).
 * Request schemas are strict: unknown fields are rejected, so a client cannot smuggle in fields
 * such as roles, status or user ids.
 */

/** Generous upper bounds stop oversized input before any expensive work (password hashing). */
const LOGIN_ID_MAX = 64;
const PASSWORD_INPUT_MAX = 1024;
const REFRESH_TOKEN_MAX = 256;

export const deviceLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N} ._()-]+$/u, 'Device label contains unsupported characters');

export const loginRequestSchema = z.strictObject({
  loginId: z.string().trim().min(1).max(LOGIN_ID_MAX),
  password: z.string().min(1).max(PASSWORD_INPUT_MAX),
  /** Optional, minimal, user-visible label such as "Android phone". No device identifiers. */
  deviceLabel: deviceLabelSchema.optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.strictObject({
  refreshToken: z.string().min(1).max(REFRESH_TOKEN_MAX),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = refreshRequestSchema;
export type LogoutRequest = RefreshRequest;

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_INPUT_MAX),
  newPassword: z.string().min(1).max(PASSWORD_INPUT_MAX),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  /** Stored language code; the app falls back to its default when it does not support it. */
  preferredLanguage: z.string(),
  /** When true, only change-password, me and logout are allowed until the password is changed. */
  mustChangePassword: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** Returned by login, refresh and change-password. */
export const authTokensResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.string(),
  user: authUserSchema,
});
export type AuthTokensResponse = z.infer<typeof authTokensResponseSchema>;

/**
 * Browser sign-in for the admin portal (/auth/web/*). The refresh token is set in an httpOnly,
 * SameSite=Strict cookie scoped to /api/v1/auth/web and is NEVER in the JSON body, so page
 * scripts cannot read or leak it. The access token stays in memory only.
 */
export const webAuthResponseSchema = authTokensResponseSchema.omit({ refreshToken: true });
export type WebAuthResponse = z.infer<typeof webAuthResponseSchema>;

/**
 * Every /auth/web/* request must carry this header with this value. A custom header forces a
 * CORS preflight, so a page on an unlisted origin cannot even send the request.
 */
export const WEB_CLIENT_HEADER = 'x-balswasthya-client';
export const WEB_CLIENT_VALUE = 'admin-portal';

/** The app adapts its UI to `access`; the API never relies on it (every request is re-checked). */
export const meResponseSchema = z.object({ user: authUserSchema, access: effectiveAccessSchema });
export type MeResponse = z.infer<typeof meResponseSchema>;

export const sessionSummarySchema = z.object({
  sessionId: z.string(),
  deviceLabel: z.string().nullable(),
  lastActiveAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean(),
});
export const sessionListResponseSchema = z.object({ sessions: z.array(sessionSummarySchema) });
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

/** Error codes the app reacts to. Messages are generic by design. */
export const AUTH_ERROR_CODES = {
  invalidCredentials: 'INVALID_CREDENTIALS',
  unauthenticated: 'UNAUTHENTICATED',
  sessionExpired: 'SESSION_EXPIRED',
  passwordChangeRequired: 'PASSWORD_CHANGE_REQUIRED',
  passwordPolicy: 'PASSWORD_POLICY',
  invalidCurrentPassword: 'INVALID_CURRENT_PASSWORD',
  tooManyRequests: 'TOO_MANY_REQUESTS',
} as const;
