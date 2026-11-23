import {
  assignmentListResponseSchema,
  assignmentResponseSchema,
  type CreateAssignmentRequest,
} from '@balswasthya/shared-contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../../app/services';
import { userKeys } from '../users/api';

/** Data access for area assignments (stage PD). The API checks every change again. */
export interface AssignmentListParams {
  search?: string;
  status?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  include: 'current' | 'all';
  page: number;
}

export const ASSIGNMENTS_PAGE_SIZE = 20;

export const assignmentKeys = {
  all: ['assignments'] as const,
  list: (params: AssignmentListParams) => ['assignments', 'list', params] as const,
};

export function useAssignmentList(params: AssignmentListParams) {
  const { api } = useServices();
  return useQuery({
    queryKey: assignmentKeys.list(params),
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({
        include: params.include,
        page: String(params.page),
        pageSize: String(ASSIGNMENTS_PAGE_SIZE),
      });
      if (params.search) query.set('search', params.search);
      if (params.status) query.set('status', params.status);
      return api.get(`/assignments?${query.toString()}`, assignmentListResponseSchema, { signal });
    },
    placeholderData: keepPreviousData,
  });
}

/** After any assignment change, users and assignments are reloaded everywhere. */
function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: assignmentKeys.all }),
      queryClient.invalidateQueries({ queryKey: userKeys.all }),
    ]);
}

export function useCreateAssignment() {
  const { api } = useServices();
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateAssignmentRequest) => api.post('/assignments', input, assignmentResponseSchema),
    onSuccess: () => void invalidate(),
  });
}

export type AssignmentAction = 'end' | 'suspend' | 'reactivate' | 'revoke';

export function useAssignmentAction(assignmentId: string) {
  const { api } = useServices();
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      action,
      reason,
      effectiveTo,
    }: {
      action: AssignmentAction;
      reason: string;
      effectiveTo?: string;
    }) =>
      api.post(
        `/assignments/${encodeURIComponent(assignmentId)}/${action}`,
        action === 'end' && effectiveTo ? { reason, effectiveTo } : { reason },
        assignmentResponseSchema,
      ),
    // Also on failure: a 409 means the assignment changed meanwhile, so show the current state.
    onSettled: () => void invalidate(),
  });
}
