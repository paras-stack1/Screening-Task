import {
  areaListResponseSchema,
  MANAGEMENT_PERMISSIONS,
  roleListResponseSchema,
  temporaryPasswordResponseSchema,
  userDetailResponseSchema,
  userListResponseSchema,
  userViewSchema,
  type ChangeUserStatusRequest,
  type CreateUserRequest,
  type RoleView,
} from '@balswasthya/shared-contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useServices } from '../../app/services';

/**
 * Data access for user administration (stage PC). Every call goes through the authenticated
 * API client; the API decides what the administrator may see and do.
 *
 * One-time passwords (create, reset) are returned to the calling page only. They are never put
 * in the query cache, and the mutations keep no result after the page is left (gcTime 0).
 */
export const userKeys = {
  all: ['users'] as const,
  list: (query: UserListParams) => ['users', 'list', query] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
  roles: ['roles'] as const,
  areas: (key: { parentId?: string; search?: string }) => ['areas', key] as const,
};

export interface UserListParams {
  search?: string;
  status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  page: number;
}

export const USERS_PAGE_SIZE = 20;

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function useUserList(params: UserListParams, enabled = true) {
  const { api } = useServices();
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) =>
      api.get(`/users${queryString({ ...params, pageSize: USERS_PAGE_SIZE })}`, userListResponseSchema, {
        signal,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useUserDetail(userId: string) {
  const { api } = useServices();
  return useQuery({
    queryKey: userKeys.detail(userId),
    queryFn: ({ signal }) =>
      api.get(`/users/${encodeURIComponent(userId)}`, userDetailResponseSchema, { signal }),
  });
}

export function useRoles() {
  const { api } = useServices();
  return useQuery({
    queryKey: userKeys.roles,
    queryFn: ({ signal }) => api.get('/roles', roleListResponseSchema, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useAreas(key: { parentId?: string; search?: string }, enabled = true) {
  const { api } = useServices();
  return useQuery({
    queryKey: userKeys.areas(key),
    queryFn: ({ signal }) =>
      api.get(
        `/areas${queryString({ parentId: key.parentId, search: key.search })}`,
        areaListResponseSchema,
        {
          signal,
        },
      ),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * Roles this administrator could possibly give: every MANAGEMENT permission of the role must be
 * one the administrator holds (somewhere). The API checks this again for the chosen area; this
 * only hides roles that would certainly be refused.
 */
export function grantableRoles(roles: RoleView[], ownPermissions: readonly string[]): RoleView[] {
  const own = new Set(ownPermissions);
  const management = new Set<string>(MANAGEMENT_PERMISSIONS);
  return roles.filter((role) => role.permissions.every((p) => !management.has(p) || own.has(p)));
}

export function useCreateUser() {
  const { api } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserRequest) => api.post('/users', input, temporaryPasswordResponseSchema),
    gcTime: 0,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useChangeUserStatus(userId: string) {
  const { api } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangeUserStatusRequest) =>
      api.post(`/users/${encodeURIComponent(userId)}/status`, input, z.object({ user: userViewSchema })),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useResetPassword(userId: string) {
  const { api } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post(
        `/users/${encodeURIComponent(userId)}/reset-password`,
        { reason },
        temporaryPasswordResponseSchema,
      ),
    gcTime: 0,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useRevokeSessions(userId: string) {
  const { api } = useServices();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post(`/users/${encodeURIComponent(userId)}/revoke-sessions`, { reason }),
  });
}
