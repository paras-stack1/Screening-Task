import {
  notificationListResponseSchema,
  notificationSchema,
  resultDashboardSchema,
  resultListResponseSchema,
  reviewDetailResponseSchema,
  reviewListResponseSchema,
  sessionResultsResponseSchema,
  type ResultOutcome,
  type ReviewDecisionRequest,
} from '@balswasthya/shared-contracts';
import { z } from 'zod';
import type { ApiClient, RequestOptions } from '../../services/api/client';

/**
 * Step 7 calls used by the result, clinical review and notification screens
 * (docs/step-7/api-documentation.md). Every response is validated against the shared contract;
 * URLs carry opaque ids only. Reviewer identity, permissions and status are decided by the API.
 */
export const RESULTS_PAGE_SIZE = 20;
const resultDashboardResponse = z.object({ dashboard: resultDashboardSchema });
const notificationResponse = z.object({ notification: notificationSchema });

export function createResultsApi(api: ApiClient) {
  const id = (value: string) => encodeURIComponent(value);
  return {
    sessionResults: (sessionId: string, options?: RequestOptions) =>
      api.get(`/screenings/${id(sessionId)}/results`, sessionResultsResponseSchema, options),
    list: (page: number, outcome: ResultOutcome | null, options?: RequestOptions) =>
      api.get(
        `/screening-results?page=${page}&pageSize=${RESULTS_PAGE_SIZE}${outcome ? `&outcome=${outcome}` : ''}`,
        resultListResponseSchema,
        options,
      ),
    dashboard: (options?: RequestOptions) => api.get('/dashboards/results', resultDashboardResponse, options),

    reviews: (page: number, options?: RequestOptions) =>
      api.get(
        `/clinical-reviews?page=${page}&pageSize=${RESULTS_PAGE_SIZE}`,
        reviewListResponseSchema,
        options,
      ),
    review: (reviewId: string, options?: RequestOptions) =>
      api.get(`/clinical-reviews/${id(reviewId)}`, reviewDetailResponseSchema, options),
    claim: (reviewId: string, expectedVersion: number) =>
      api.post(`/clinical-reviews/${id(reviewId)}/claim`, { expectedVersion }, reviewDetailResponseSchema),
    release: (reviewId: string, expectedVersion: number) =>
      api.post(`/clinical-reviews/${id(reviewId)}/release`, { expectedVersion }, reviewDetailResponseSchema),
    decide: (reviewId: string, body: ReviewDecisionRequest) =>
      api.post(`/clinical-reviews/${id(reviewId)}/decision`, body, reviewDetailResponseSchema),

    notifications: (page: number, options?: RequestOptions) =>
      api.get(
        `/notifications?page=${page}&pageSize=${RESULTS_PAGE_SIZE}`,
        notificationListResponseSchema,
        options,
      ),
    markRead: (notificationId: string) =>
      api.post(`/notifications/${id(notificationId)}/read`, {}, notificationResponse),
  };
}

export type ResultsApi = ReturnType<typeof createResultsApi>;
