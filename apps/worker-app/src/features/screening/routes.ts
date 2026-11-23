import type { FourDCategoryCode } from '@balswasthya/shared-contracts';
import type { Href } from 'expo-router';

/**
 * Links to the screening screens. Only opaque ids and category codes go into URLs - never names,
 * ages or answers. Plain paths, built in one place (see children/routes.ts for why).
 */
const seg = (value: string) => encodeURIComponent(value);

export const screeningRoutes = {
  home: '/screening' as Href,
  selectChild: '/screening/select-child' as Href,
  start: (childId: string) => `/screening/start/${seg(childId)}` as Href,
  session: (sessionId: string) => `/screening/${seg(sessionId)}` as Href,
  category: (sessionId: string, category: FourDCategoryCode) =>
    `/screening/${seg(sessionId)}/category/${category}` as Href,
  review: (sessionId: string) => `/screening/${seg(sessionId)}/review` as Href,
  summary: (sessionId: string) => `/screening/${seg(sessionId)}/summary` as Href,
  history: (childId: string) => `/screening/history/${seg(childId)}` as Href,
  measurements: (sessionId: string) => `/screening/${seg(sessionId)}/measurements` as Href,
  /** Amend a completed screening (Step 6G-2). */
  amend: (sessionId: string) => `/screening/${seg(sessionId)}/amend` as Href,
  /** Summary right after an amendment was saved (shows a confirmation). */
  summaryAfterAmendment: (sessionId: string) => `/screening/${seg(sessionId)}/summary?amended=1` as Href,
  /** Medical officer: amendments waiting for review. */
  reviewQueue: '/screening/review-queue' as Href,
};
