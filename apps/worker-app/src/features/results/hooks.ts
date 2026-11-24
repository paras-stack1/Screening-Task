import type { ResultOutcome, ReviewDecisionRequest } from '@balswasthya/shared-contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAppServices } from '../../services/appServices';
import { queryKeys } from '../../services/query/queryKeys';
import { useAuthenticatedUser } from '../auth/AuthProvider';
import { createResultsApi } from './api';

export function useResultsApi() {
  const { api } = useAppServices();
  return useMemo(() => createResultsApi(api), [api]);
}

function useUserId(): string {
  return useAuthenticatedUser()?.id ?? 'none';
}

const nextPage = (last: { page: number; pageSize: number; total: number }) =>
  last.page * last.pageSize < last.total ? last.page + 1 : undefined;

/** Current result and version history of one screening. Always fresh (results can be amended). */
export function useSessionResults(sessionId: string, enabled = true) {
  const results = useResultsApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.sessionResults(userId, sessionId),
    queryFn: ({ signal }) => results.sessionResults(sessionId, { signal }),
    enabled: enabled && userId !== 'none' && Boolean(sessionId),
  });
}

export function useResultList(outcome: ResultOutcome | null, enabled = true) {
  const results = useResultsApi();
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: queryKeys.resultList(userId, outcome ?? 'ALL'),
    queryFn: ({ pageParam, signal }) => results.list(pageParam, outcome, { signal }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: enabled && userId !== 'none',
  });
}

export function useResultDashboard(enabled = true) {
  const results = useResultsApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.resultDashboard(userId),
    queryFn: ({ signal }) => results.dashboard({ signal }),
    enabled: enabled && userId !== 'none',
  });
}

/** Medical officer's queue of clinical reviews (open, current versions, oldest first). */
export function useReviewQueue(enabled = true) {
  const results = useResultsApi();
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: queryKeys.reviewQueue(userId),
    queryFn: ({ pageParam, signal }) => results.reviews(pageParam, { signal }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: enabled && userId !== 'none',
  });
}

export function useReview(reviewId: string, enabled = true) {
  const results = useResultsApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.review(userId, reviewId),
    queryFn: ({ signal }) => results.review(reviewId, { signal }),
    enabled: enabled && userId !== 'none' && Boolean(reviewId),
  });
}

/**
 * Claim / release / decide. Every call sends the version the screen showed; a 409 means someone
 * else changed the review and the screen reloads it. On success the review, the queue, results
 * and dashboards are refreshed (a decision may create a referral or follow-up).
 */
export function useReviewActions(reviewId: string) {
  const results = useResultsApi();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const settle = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.review(userId, reviewId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.reviewQueue(userId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.resultDashboard(userId) }),
      queryClient.invalidateQueries({ queryKey: [userId, 'results'] }),
    ]);
  };
  const store = (data: Awaited<ReturnType<typeof results.review>>) =>
    queryClient.setQueryData(queryKeys.review(userId, reviewId), data);
  return {
    claim: useMutation({
      mutationFn: (version: number) => results.claim(reviewId, version),
      onSuccess: store,
      onSettled: settle,
    }),
    release: useMutation({
      mutationFn: (version: number) => results.release(reviewId, version),
      onSuccess: store,
      onSettled: settle,
    }),
    decide: useMutation({
      mutationFn: (body: ReviewDecisionRequest) => results.decide(reviewId, body),
      onSuccess: store,
      onSettled: settle,
    }),
  };
}

export function useNotifications(enabled = true) {
  const results = useResultsApi();
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: queryKeys.notifications(userId),
    queryFn: ({ pageParam, signal }) => results.notifications(pageParam, { signal }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: enabled && userId !== 'none',
  });
}

export function useMarkNotificationRead() {
  const results = useResultsApi();
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => results.markRead(notificationId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId) }),
  });
}
