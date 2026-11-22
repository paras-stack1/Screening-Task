import {
  screeningDashboardSummarySchema,
  screeningEligibilityResponseSchema,
  screeningListResponseSchema,
  screeningProtocolDetailResponseSchema,
  screeningSessionResponseSchema,
  type AddMeasurementRequest,
  type CorrectMeasurementRequest,
  type FourDCategoryCode,
  type SaveResponsesRequest,
  type SessionStatus,
  type StartScreeningRequest,
  type UpdateCategoryRequest,
} from '@balswasthya/shared-contracts';
import type { ApiClient, RequestOptions } from '../../services/api/client';

/**
 * Screening calls (docs/step-6/screening-api.md). Every response is validated against the shared
 * contract. Paths carry only opaque ids. Writes send the session `expectedVersion` the screen last
 * saw; the API refuses stale writes (409 VERSION_CONFLICT) instead of overwriting newer data.
 */
export function createScreeningApi(api: ApiClient) {
  const id = (value: string) => encodeURIComponent(value);
  const session = (sessionId: string) => `/screenings/${id(sessionId)}`;
  return {
    summary: (options?: RequestOptions) =>
      api.get('/screenings/summary', screeningDashboardSummarySchema, options),
    listMine: (status: SessionStatus, options?: RequestOptions) =>
      api.get(`/screenings?mine=true&status=${status}&pageSize=20`, screeningListResponseSchema, options),
    eligibility: (childId: string, options?: RequestOptions) =>
      api.get(`/children/${id(childId)}/screening-eligibility`, screeningEligibilityResponseSchema, options),
    protocol: (protocolId: string, options?: RequestOptions) =>
      api.get(`/screening-protocols/${id(protocolId)}`, screeningProtocolDetailResponseSchema, options),
    get: (sessionId: string, options?: RequestOptions) =>
      api.get(session(sessionId), screeningSessionResponseSchema, options),
    start: (body: StartScreeningRequest) => api.post('/screenings', body, screeningSessionResponseSchema),
    startCategory: (sessionId: string, expectedVersion: number, category: FourDCategoryCode) =>
      api.post(
        `${session(sessionId)}/categories`,
        { expectedVersion, category },
        screeningSessionResponseSchema,
      ),
    saveResponses: (sessionId: string, category: FourDCategoryCode, body: SaveResponsesRequest) =>
      api.post(
        `${session(sessionId)}/categories/${category}/responses`,
        body,
        screeningSessionResponseSchema,
      ),
    updateCategory: (sessionId: string, category: FourDCategoryCode, body: UpdateCategoryRequest) =>
      api.patch(`${session(sessionId)}/categories/${category}`, body, screeningSessionResponseSchema),
    addMeasurement: (sessionId: string, body: AddMeasurementRequest) =>
      api.post(`${session(sessionId)}/measurements`, body, screeningSessionResponseSchema),
    correctMeasurement: (sessionId: string, measurementId: string, body: CorrectMeasurementRequest) =>
      api.post(
        `${session(sessionId)}/measurements/${id(measurementId)}/corrections`,
        body,
        screeningSessionResponseSchema,
      ),
  };
}

export type ScreeningApi = ReturnType<typeof createScreeningApi>;
