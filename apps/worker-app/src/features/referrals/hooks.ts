import type { ReferralStatus } from '@balswasthya/shared-contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAppServices } from '../../services/appServices';
import { queryKeys } from '../../services/query/queryKeys';
import { useAuthenticatedUser } from '../auth/AuthProvider';
import { useMe } from '../auth/hooks/useMe';
import { createReferralsApi, type FollowUpFilter } from './api';

export function useReferralsApi() {
  const { api } = useAppServices();
  return useMemo(() => createReferralsApi(api), [api]);
}

function useUserId(): string {
  return useAuthenticatedUser()?.id ?? 'none';
}

const nextPage = (last: { page: number; pageSize: number; total: number }) =>
  last.page * last.pageSize < last.total ? last.page + 1 : undefined;

/** Display decisions only (from /auth/me). The API checks every request and every action. */
export function useReferralPermissions() {
  const me = useMe();
  const p = me.data?.access.permissions ?? [];
  return {
    loaded: Boolean(me.data),
    canRead: p.includes('child.read'),
    canCreate: p.includes('referral.create'),
    canApprove: p.includes('referral.approve'),
    canUpdate: p.includes('referral.update'),
    canWorkFollowUps: p.includes('follow_up.update') || p.includes('referral.update'),
  };
}

export function useReferralDashboard(enabled = true) {
  const api = useReferralsApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.referralDashboard(userId),
    queryFn: ({ signal }) => api.dashboard({ signal }),
    enabled: enabled && userId !== 'none',
  });
}

export function useReferralList(status: ReferralStatus | null, awaitingApproval: boolean, enabled = true) {
  const api = useReferralsApi();
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: queryKeys.referralList(userId, `${status ?? 'ALL'}:${awaitingApproval}`),
    queryFn: ({ pageParam, signal }) => api.list(pageParam, status, awaitingApproval, { signal }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: enabled && userId !== 'none',
  });
}

export function useReferral(referralId: string) {
  const api = useReferralsApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.referral(userId, referralId),
    queryFn: ({ signal }) => api.get(referralId, { signal }),
    enabled: userId !== 'none' && Boolean(referralId),
  });
}

export function useFacilityOptions(childId: string, includeOutOfDistrict: boolean, enabled = true) {
  const api = useReferralsApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.facilityOptions(userId, childId, includeOutOfDistrict),
    queryFn: ({ signal }) => api.facilities(childId, includeOutOfDistrict, { signal }),
    enabled: enabled && userId !== 'none' && Boolean(childId),
  });
}

export function useFollowUpList(filter: FollowUpFilter, referralId: string | null = null, enabled = true) {
  const api = useReferralsApi();
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: queryKeys.followUpList(userId, `${filter}:${referralId ?? ''}`),
    queryFn: ({ pageParam, signal }) => api.followUps(pageParam, filter, referralId, { signal }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: enabled && userId !== 'none',
  });
}

export function useFollowUp(followUpId: string) {
  const api = useReferralsApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.followUp(userId, followUpId),
    queryFn: ({ signal }) => api.followUp(followUpId, { signal }),
    enabled: userId !== 'none' && Boolean(followUpId),
  });
}

/**
 * Any referral or follow-up change: refreshes the record, lists and dashboards afterwards (a 409
 * conflict also reloads, so the screen shows the newer state).
 */
export function useReferralMutation<A, R>(fn: (args: A) => Promise<R>) {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [userId, 'referrals'] }),
        queryClient.invalidateQueries({ queryKey: [userId, 'follow-ups'] }),
        queryClient.invalidateQueries({ queryKey: [userId, 'notifications'] }),
      ]),
  });
}
