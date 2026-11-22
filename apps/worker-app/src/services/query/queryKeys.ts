/**
 * Query keys. Every key starts with the signed-in user's id, so cached data can never be served
 * to a different account even if the cache were not cleared (it is, on every sign-out).
 * Child data is kept in memory only (never persisted to the device).
 */
export const queryKeys = {
  me: (userId: string) => [userId, 'auth', 'me'] as const,
  childrenTotal: (userId: string) => [userId, 'children', 'total'] as const,
  /** Prefix of every child-data query: invalidated after any child, guardian or link change. */
  childData: (userId: string) => [userId, 'children'] as const,
  childList: (userId: string, search: string) => [userId, 'children', 'list', search] as const,
  child: (userId: string, childId: string) => [userId, 'children', 'detail', childId] as const,
  childLinks: (userId: string, childId: string, includeEnded: boolean) =>
    [userId, 'children', 'links', childId, includeEnded] as const,
  registrationAreas: (userId: string) => [userId, 'children', 'registration-areas'] as const,
  guardian: (userId: string, guardianId: string) => [userId, 'children', 'guardian', guardianId] as const,
};
