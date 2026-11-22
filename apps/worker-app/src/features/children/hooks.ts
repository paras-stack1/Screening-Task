import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAppServices } from '../../services/appServices';
import { queryKeys } from '../../services/query/queryKeys';
import { useAuthenticatedUser } from '../auth/AuthProvider';
import { useMe } from '../auth/hooks/useMe';
import { CHILD_PAGE_SIZE, createChildrenApi } from './api';

export function useChildrenApi() {
  const { api } = useAppServices();
  return useMemo(() => createChildrenApi(api), [api]);
}

function useUserId(): string {
  return useAuthenticatedUser()?.id ?? 'none';
}

/**
 * Permissions from GET /auth/me, used ONLY to decide which buttons to show. The API checks every
 * request itself; a hidden button is a convenience, never the protection.
 */
export function useChildPermissions() {
  const me = useMe();
  const permissions = me.data?.access.permissions ?? [];
  return {
    loaded: Boolean(me.data),
    canRead: permissions.includes('child.read'),
    canCreate: permissions.includes('child.create'),
    canUpdate: permissions.includes('child.update'),
    canRecordConsent: permissions.includes('consent.record'),
  };
}

/** Paged child list (20 per page, "load more"); search needs at least 2 characters. */
export function useChildList(search: string, enabled = true) {
  const children = useChildrenApi();
  const userId = useUserId();
  const term = search.trim().length >= 2 ? search.trim() : '';
  return useInfiniteQuery({
    queryKey: queryKeys.childList(userId, term),
    queryFn: ({ pageParam, signal }) =>
      children.list({ search: term || undefined, page: pageParam }, { signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: enabled && userId !== 'none',
  });
}

export function useChild(childId: string) {
  const children = useChildrenApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.child(userId, childId),
    queryFn: ({ signal }) => children.get(childId, { signal }).then((r) => r.child),
    enabled: userId !== 'none' && Boolean(childId),
  });
}

export function useChildLinks(childId: string, includeEnded: boolean) {
  const children = useChildrenApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.childLinks(userId, childId, includeEnded),
    queryFn: ({ signal }) => children.links(childId, includeEnded, { signal }).then((r) => r.items),
    enabled: userId !== 'none' && Boolean(childId),
  });
}

export function useRegistrationAreas(enabled = true) {
  const children = useChildrenApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.registrationAreas(userId),
    queryFn: ({ signal }) => children.registrationAreas({ signal }),
    enabled: enabled && userId !== 'none',
  });
}

export function useGuardian(guardianId: string) {
  const children = useChildrenApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.guardian(userId, guardianId),
    queryFn: ({ signal }) => children.guardian(guardianId, { signal }).then((r) => r.guardian),
    enabled: userId !== 'none' && Boolean(guardianId),
    // The guardian view reveals the full phone number: never keep it around longer than needed.
    gcTime: 0,
    staleTime: 0,
  });
}

/** After any child, guardian or link change: every child-data query is refetched. */
export function useInvalidateChildData() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.childData(userId) });
}

export { CHILD_PAGE_SIZE };
