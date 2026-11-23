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
  childConsents: (userId: string, childId: string) => [userId, 'children', 'consents', childId] as const,
  consentNotices: (userId: string, language: string) => [userId, 'consent-notices', language] as const,
  recentChildren: (userId: string) => [userId, 'children', 'recent'] as const,
  guardian: (userId: string, guardianId: string) => [userId, 'children', 'guardian', guardianId] as const,
  /** Prefix of every screening query: invalidated after any screening change. In memory only. */
  screeningData: (userId: string) => [userId, 'screening'] as const,
  screeningSummary: (userId: string) => [userId, 'screening', 'summary'] as const,
  screeningMine: (userId: string, status: string) => [userId, 'screening', 'mine', status] as const,
  screeningEligibility: (userId: string, childId: string) =>
    [userId, 'screening', 'eligibility', childId] as const,
  screeningHistory: (userId: string, childId: string) => [userId, 'screening', 'history', childId] as const,
  screeningSession: (userId: string, sessionId: string) =>
    [userId, 'screening', 'session', sessionId] as const,
  /** Protocol versions are immutable once used, so they may be cached for the app session. */
  screeningProtocol: (userId: string, protocolId: string) =>
    [userId, 'screening-protocol', protocolId] as const,
};
