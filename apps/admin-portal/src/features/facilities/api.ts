import {
  aggregateReportSchema,
  facilityDetailResponseSchema,
  facilityListResponseSchema,
  type AggregateReportQuery,
  type CreateFacilityRequest,
  type FacilityReasonRequest,
  type UpdateFacilityRequest,
  type VerifyFacilityRequest,
} from '@balswasthya/shared-contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useServices } from '../../app/services';

/**
 * Facility directory administration and aggregate reports (Step 7G). The API decides scope
 * (facility.manage / report.aggregate over the area), versions (409) and verification rules.
 */
export const facilityKeys = {
  all: ['facilities'] as const,
  list: (q: string) => ['facilities', 'list', q] as const,
  detail: (id: string) => ['facilities', 'detail', id] as const,
};
const reportResponse = z.object({ report: aggregateReportSchema });

export function useFacilityList(search: string) {
  const { api } = useServices();
  return useQuery({
    queryKey: facilityKeys.list(search),
    queryFn: ({ signal }) =>
      api.get(`/facilities${search ? `?q=${encodeURIComponent(search)}` : ''}`, facilityListResponseSchema, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useFacility(id: string) {
  const { api } = useServices();
  return useQuery({
    queryKey: facilityKeys.detail(id),
    queryFn: ({ signal }) =>
      api.get(`/facilities/${encodeURIComponent(id)}`, facilityDetailResponseSchema, { signal }),
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: facilityKeys.all });
}

export function useCreateFacility() {
  const { api } = useServices();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateFacilityRequest) => api.post('/facilities', body, facilityDetailResponseSchema),
    onSuccess: () => void invalidate(),
  });
}

export type FacilityAction =
  | { kind: 'update'; body: UpdateFacilityRequest }
  | { kind: 'verify'; body: VerifyFacilityRequest }
  | { kind: 'unverify' | 'deactivate' | 'reactivate'; body: FacilityReasonRequest };

/** One mutation for every change of a facility; afterwards everything is reloaded (also on 409). */
export function useFacilityAction(id: string) {
  const { api } = useServices();
  const invalidate = useInvalidate();
  const path = `/facilities/${encodeURIComponent(id)}`;
  return useMutation({
    mutationFn: (action: FacilityAction) =>
      action.kind === 'update'
        ? api.patch(path, action.body, facilityDetailResponseSchema)
        : api.post(`${path}/${action.kind}`, action.body, facilityDetailResponseSchema),
    onSettled: () => void invalidate(),
  });
}

export function useAggregateReport(query: AggregateReportQuery | null) {
  const { api } = useServices();
  return useQuery({
    queryKey: ['reports', 'aggregate', query],
    queryFn: ({ signal }) => {
      const q = query!;
      const params = new URLSearchParams({ areaId: q.areaId, from: q.from, to: q.to });
      return api.get(`/reports/aggregate?${params.toString()}`, reportResponse, { signal });
    },
    enabled: query !== null,
  });
}
