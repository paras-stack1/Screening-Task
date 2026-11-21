import {
  authTokensResponseSchema,
  meResponseSchema,
  type AuthTokensResponse,
  type ChangePasswordRequest,
  type LoginRequest,
  type MeResponse,
} from '@balswasthya/shared-contracts';
import { Platform } from 'react-native';
import type { HttpRequestFn } from '../../../services/api/http';

/**
 * Step 3 authentication endpoints (docs/authentication.md). Response shapes come only from the
 * shared contracts; nothing here invents fields.
 */
export interface AuthApi {
  login(input: LoginRequest): Promise<AuthTokensResponse>;
  refresh(refreshToken: string): Promise<AuthTokensResponse>;
  /** Always 204 on the server, also for unknown tokens. */
  logout(refreshToken: string): Promise<void>;
  changePassword(accessToken: string, input: ChangePasswordRequest): Promise<AuthTokensResponse>;
  me(accessToken: string, signal?: AbortSignal): Promise<MeResponse>;
}

/** Decision L: a generic, user-visible label only. No model names or device identifiers. */
export function defaultDeviceLabel(): string {
  switch (Platform.OS) {
    case 'android':
      return 'Android phone';
    case 'ios':
      return 'iPhone';
    default:
      return 'Web browser';
  }
}

export function createAuthApi(request: HttpRequestFn): AuthApi {
  return {
    login: (input) =>
      request({ method: 'POST', path: '/auth/login', body: input, schema: authTokensResponseSchema }),
    refresh: (refreshToken) =>
      request({
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken },
        schema: authTokensResponseSchema,
      }),
    logout: (refreshToken) => request({ method: 'POST', path: '/auth/logout', body: { refreshToken } }),
    changePassword: (accessToken, input) =>
      request({
        method: 'POST',
        path: '/auth/change-password',
        body: input,
        accessToken,
        schema: authTokensResponseSchema,
      }),
    me: (accessToken, signal) =>
      request({ method: 'GET', path: '/auth/me', accessToken, signal, schema: meResponseSchema }),
  };
}
