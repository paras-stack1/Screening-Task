import type { ScreeningSessionResponse } from '@balswasthya/shared-contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAppServices } from '../../services/appServices';
import { queryKeys } from '../../services/query/queryKeys';
import { useAuthenticatedUser } from '../auth/AuthProvider';
import { useMe } from '../auth/hooks/useMe';
import { createScreeningApi } from './api';

export function useScreeningApi() {
  const { api } = useAppServices();
  return useMemo(() => createScreeningApi(api), [api]);
}

function useUserId(): string {
  return useAuthenticatedUser()?.id ?? 'none';
}

/** Display decision only (from /auth/me). The API checks every request itself. */
export function useScreeningPermissions() {
  const me = useMe();
  const permissions = me.data?.access.permissions ?? [];
  return {
    loaded: Boolean(me.data),
    canConduct: permissions.includes('screening.conduct'),
    canRead: permissions.includes('child.read'),
  };
}

/** The caller's own real counts (GET /screenings/summary). */
export function useScreeningSummary(enabled = true) {
  const screening = useScreeningApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.screeningSummary(userId),
    queryFn: ({ signal }) => screening.summary({ signal }),
    enabled: enabled && userId !== 'none',
  });
}

/** The caller's unfinished sessions: drafts and in-progress, for "continue screening". */
export function useMyOpenSessions(enabled = true) {
  const screening = useScreeningApi();
  const userId = useUserId();
  const inProgress = useQuery({
    queryKey: queryKeys.screeningMine(userId, 'IN_PROGRESS'),
    queryFn: ({ signal }) => screening.listMine('IN_PROGRESS', { signal }),
    enabled: enabled && userId !== 'none',
  });
  const drafts = useQuery({
    queryKey: queryKeys.screeningMine(userId, 'DRAFT'),
    queryFn: ({ signal }) => screening.listMine('DRAFT', { signal }),
    enabled: enabled && userId !== 'none',
  });
  return { inProgress, drafts };
}

/** Age, consent and protocol availability, decided by the API. Always fresh. */
export function useScreeningEligibility(childId: string) {
  const screening = useScreeningApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.screeningEligibility(userId, childId),
    queryFn: ({ signal }) => screening.eligibility(childId, { signal }),
    enabled: userId !== 'none' && Boolean(childId),
    staleTime: 0,
  });
}

export function useScreeningSession(sessionId: string) {
  const screening = useScreeningApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.screeningSession(userId, sessionId),
    queryFn: ({ signal }) => screening.get(sessionId, { signal }).then((r) => r.session),
    enabled: userId !== 'none' && Boolean(sessionId),
  });
}

/** A protocol version's questions. Versions used by sessions are frozen, so caching is safe. */
export function useScreeningProtocol(protocolId: string | undefined) {
  const screening = useScreeningApi();
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.screeningProtocol(userId, protocolId ?? ''),
    queryFn: ({ signal }) => screening.protocol(protocolId!, { signal }).then((r) => r.protocol),
    enabled: userId !== 'none' && Boolean(protocolId),
    staleTime: Infinity,
  });
}

/**
 * After a successful write: the returned session (with its new version) replaces the cached one,
 * and the lists and counts are refetched. Nothing is written to device storage.
 */
export function useApplySessionUpdate() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return (response: ScreeningSessionResponse) => {
    queryClient.setQueryData(queryKeys.screeningSession(userId, response.session.id), response.session);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.screeningData(userId),
      predicate: (query) => query.queryKey[2] !== 'session' || query.queryKey[3] !== response.session.id,
    });
  };
}

/** Refetch one session (e.g. after a VERSION_CONFLICT). */
export function useRefetchSession(sessionId: string) {
  const queryClient = useQueryClient();
  const userId = useUserId();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.screeningSession(userId, sessionId) });
}
