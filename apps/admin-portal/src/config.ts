import { parseApiBaseUrl } from './apiBaseUrl';

export { parseApiBaseUrl };

/**
 * Build-time configuration (VITE_* values are public: they are inside the page). Validated once;
 * an invalid value makes every API call fail with a clear "not configured" error instead of
 * silently calling a wrong address.
 */
export interface PortalConfig {
  /** Absolute API base URL ending in /api/v1, or null when missing/invalid. */
  apiBaseUrl: string | null;
}

export const config: PortalConfig = {
  apiBaseUrl: parseApiBaseUrl(import.meta.env.VITE_API_BASE_URL as string | undefined, import.meta.env.PROD),
};
