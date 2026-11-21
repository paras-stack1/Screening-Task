import { useQuery } from '@tanstack/react-query';
import { useAppServices } from '../../../services/appServices';
import { queryKeys } from '../../../services/query/queryKeys';
import { useAuthenticatedUser } from '../AuthProvider';

/**
 * GET /auth/me: the signed-in user's roles, permissions and assigned areas. Used to adapt the UI
 * only (e.g. hide a metric the role cannot read); the API authorises every request itself.
 */
export function useMe() {
  const { session, authApi } = useAppServices();
  const user = useAuthenticatedUser();
  return useQuery({
    queryKey: queryKeys.me(user?.id ?? 'none'),
    queryFn: ({ signal }) => session.authorized((token) => authApi.me(token, signal)),
    enabled: Boolean(user),
  });
}
