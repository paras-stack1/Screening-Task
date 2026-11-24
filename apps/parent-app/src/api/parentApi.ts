import {
  activateParentAccountResponseSchema,
  invitationValidationResponseSchema,
  parentChildDetailResponseSchema,
  parentChildListResponseSchema,
  parentForgotPasswordResponseSchema,
  parentLegalResponseSchema,
  parentMeResponseSchema,
  parentTokensResponseSchema,
  parentWebAuthResponseSchema,
  sendOtpResponseSchema,
  verifyOtpResponseSchema,
  type ActivateParentAccountRequest,
} from '@balswasthya/shared-contracts';
import { z } from 'zod';
import type { Http } from './http';

/**
 * Parent Portal API calls (docs/api/parent-portal.md). Every response is checked against the shared
 * contract. Tokens, codes and passwords travel only in request bodies or the Authorization header.
 */
export function createParentApi(http: Http) {
  const post = <T>(path: string, body: unknown, schema?: z.ZodType<T>, accessToken?: string, web?: boolean) =>
    http<T>({ method: 'POST', path, body, schema, accessToken, web });
  return {
    // ---------------------------------------------------------------- onboarding (public)
    legal: (language: 'hi' | 'en') =>
      http({ method: 'GET', path: `/parent/legal?language=${language}`, schema: parentLegalResponseSchema }),
    validateInvitation: (token: string) =>
      post('/parent/invitations/validate', { token }, invitationValidationResponseSchema),
    sendCode: (token: string) => post('/parent/invitations/send-otp', { token }, sendOtpResponseSchema),
    verifyCode: (token: string, code: string) =>
      post('/parent/invitations/verify-otp', { token, code }, verifyOtpResponseSchema),
    activate: (body: ActivateParentAccountRequest) =>
      post('/parent/activate', body, activateParentAccountResponseSchema),

    // ---------------------------------------------------------------- sign-in (native: body tokens)
    login: (phone: string, password: string) =>
      post('/parent/auth/login', { phone, password }, parentTokensResponseSchema),
    refresh: (refreshToken: string) =>
      post('/parent/auth/refresh', { refreshToken }, parentTokensResponseSchema),
    logout: (refreshToken: string) => post('/parent/auth/logout', { refreshToken }),

    // ---------------------------------------------------------------- sign-in (browser: httpOnly cookie)
    webLogin: (phone: string, password: string) =>
      post('/parent/auth/web/login', { phone, password }, parentWebAuthResponseSchema, undefined, true),
    webRefresh: () =>
      post('/parent/auth/web/refresh', undefined, parentWebAuthResponseSchema, undefined, true),
    webLogout: () => post('/parent/auth/web/logout', undefined, undefined, undefined, true),

    forgotPassword: (phone: string) =>
      post('/parent/auth/forgot-password', { phone }, parentForgotPasswordResponseSchema),
    resetPassword: (phone: string, code: string, newPassword: string, confirmPassword: string) =>
      post(
        '/parent/auth/reset-password',
        { phone, code, newPassword, confirmPassword },
        z.object({ reset: z.literal(true) }),
      ),

    // ---------------------------------------------------------------- signed in
    me: (accessToken: string) =>
      http({ method: 'GET', path: '/parent/auth/me', schema: parentMeResponseSchema, accessToken }),
    logoutAll: (accessToken: string) => post('/parent/auth/logout-all', undefined, undefined, accessToken),
    changePassword: (
      accessToken: string,
      body: { currentPassword: string; newPassword: string; confirmPassword: string },
      web: boolean,
    ) =>
      web
        ? post('/parent/auth/web/change-password', body, parentWebAuthResponseSchema, accessToken, true)
        : post('/parent/auth/change-password', body, parentTokensResponseSchema, accessToken),
    startPhoneChange: (accessToken: string, newPhone: string, currentPassword: string) =>
      post(
        '/parent/auth/phone-change/start',
        { newPhone, currentPassword },
        sendOtpResponseSchema,
        accessToken,
      ),
    confirmPhoneChange: (accessToken: string, newPhone: string, code: string) =>
      post('/parent/auth/phone-change/confirm', { newPhone, code }, parentMeResponseSchema, accessToken),
    children: (accessToken: string) =>
      http({ method: 'GET', path: '/parent/children', schema: parentChildListResponseSchema, accessToken }),
    child: (accessToken: string, childId: string) =>
      http({
        method: 'GET',
        path: `/parent/children/${encodeURIComponent(childId)}`,
        schema: parentChildDetailResponseSchema,
        accessToken,
      }),
  };
}

export type ParentApi = ReturnType<typeof createParentApi>;
