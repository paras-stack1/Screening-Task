/**
 * Query keys. Every key starts with the signed-in user's id, so cached data can never be served
 * to a different account even if the cache were not cleared (it is, on every sign-out).
 */
export const queryKeys = {
  me: (userId: string) => [userId, 'auth', 'me'] as const,
  childrenTotal: (userId: string) => [userId, 'children', 'total'] as const,
};
