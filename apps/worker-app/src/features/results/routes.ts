import type { Href } from 'expo-router';

/** Links to the Step 7 result and review screens. Only opaque ids go into URLs. */
const seg = (value: string) => encodeURIComponent(value);

export const resultRoutes = {
  /** Result of one screening (current version + history). */
  sessionResult: (sessionId: string) => `/screening/${seg(sessionId)}/result` as Href,
  /** Results in the user's areas, with real counts. */
  list: '/screening/results' as Href,
  /** Medical officer: clinical review queue and one review. */
  reviewQueue: '/screening/reviews' as Href,
  review: (reviewId: string) => `/screening/reviews/${seg(reviewId)}` as Href,
};
