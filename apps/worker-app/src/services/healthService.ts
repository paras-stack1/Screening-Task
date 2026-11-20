import { healthResponseSchema, type HealthResponse } from '@balswasthya/shared-contracts';
import { apiGet } from './apiClient';

export function fetchApiHealth(): Promise<HealthResponse> {
  return apiGet('/health', healthResponseSchema);
}
