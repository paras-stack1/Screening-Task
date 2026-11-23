import {
  meResponseSchema,
  webAuthResponseSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type MeResponse,
  type WebAuthResponse,
} from '@balswasthya/shared-contracts';
import type { HttpRequestFn } from '../api/http';

/**
 * Raw calls to the browser sign-in endpoints (/auth/web/*, docs/admin-portal/api.md). The refresh
 * token is an httpOnly cookie the portal can never see; these calls only ask the browser to send
 * it (credentials: 'include').
 */
export interface AuthApi {
  login(input: LoginRequest): Promise<WebAuthResponse>;
  refresh(): Promise<WebAuthResponse>;
  logout(): Promise<void>;
  changePassword(accessToken: string, input: ChangePasswordRequest): Promise<WebAuthResponse>;
  me(accessToken: string): Promise<MeResponse>;
}

export const PORTAL_DEVICE_LABEL = 'Admin portal (web browser)';

export function createAuthApi(request: HttpRequestFn): AuthApi {
  return {
    login: (input) =>
      request({
        method: 'POST',
        path: '/auth/web/login',
        body: input,
        schema: webAuthResponseSchema,
        withSessionCookie: true,
      }),
    refresh: () =>
      request({
        method: 'POST',
        path: '/auth/web/refresh',
        schema: webAuthResponseSchema,
        withSessionCookie: true,
      }),
    logout: () => request({ method: 'POST', path: '/auth/web/logout', withSessionCookie: true }),
    changePassword: (accessToken, input) =>
      request({
        method: 'POST',
        path: '/auth/web/change-password',
        body: input,
        schema: webAuthResponseSchema,
        accessToken,
        withSessionCookie: true,
      }),
    me: (accessToken) => request({ method: 'GET', path: '/auth/me', schema: meResponseSchema, accessToken }),
  };
}
