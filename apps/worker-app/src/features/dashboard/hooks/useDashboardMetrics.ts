import { childListResponseSchema } from '@balswasthya/shared-contracts';
import { useQuery } from '@tanstack/react-query';
import type { MetricState } from '../../../components';
import { useAppServices } from '../../../services/appServices';
import { queryKeys } from '../../../services/query/queryKeys';
import { useAuthenticatedUser } from '../../auth/AuthProvider';
import { useMe } from '../../auth/hooks/useMe';

export interface RegisteredChildrenMetric {
  state: MetricState;
  /** True when the role has no `child.read` permission (decision Q) - not an error. */
  notForRole: boolean;
  retry: () => void;
}

/**
 * "Registered children" is the only dashboard number the API can provide today: `total` from
 * GET /children (already limited to the worker's areas by the API), fetched with pageSize=1 so no
 * child records are transferred beyond one summary row. Nothing is stored on the device.
 */
export function useRegisteredChildren(): RegisteredChildrenMetric {
  const { api } = useAppServices();
  const user = useAuthenticatedUser();
  const me = useMe();
  const canRead = me.data?.access.permissions.includes('child.read') ?? false;

  const children = useQuery({
    queryKey: queryKeys.childrenTotal(user?.id ?? 'none'),
    queryFn: ({ signal }) =>
      api.get('/children?pageSize=1', childListResponseSchema, { signal }).then((list) => list.total),
    enabled: Boolean(user) && canRead,
  });

  const retry = () => {
    if (me.isError) void me.refetch();
    else void children.refetch();
  };

  // Offline, TanStack Query pauses requests. A never-loaded, paused query is shown as "could not
  // load" (the offline banner explains why) rather than an endless spinner.
  const pausedEmpty = (query: { isPending: boolean; fetchStatus: string }) =>
    query.isPending && query.fetchStatus === 'paused';

  if (me.isError || pausedEmpty(me)) return { state: { status: 'error' }, notForRole: false, retry };
  if (me.isPending) return { state: { status: 'loading' }, notForRole: false, retry };
  if (!canRead) return { state: { status: 'unavailable' }, notForRole: true, retry };
  if (children.isError || pausedEmpty(children)) {
    return { state: { status: 'error' }, notForRole: false, retry };
  }
  if (children.isPending) return { state: { status: 'loading' }, notForRole: false, retry };
  return { state: { status: 'ready', value: children.data }, notForRole: false, retry };
}
