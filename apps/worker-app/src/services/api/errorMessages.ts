import type { TranslationKey } from '../../localization';
import { isApiError } from './errors';

/**
 * Maps any failure to a translated, user-safe message. Server messages and exception text are
 * never shown: they may be English-only, technical or (in a bug) sensitive.
 */
export function apiErrorMessageKey(error: unknown): TranslationKey {
  if (!isApiError(error)) return 'errors.unexpected';
  switch (error.kind) {
    case 'network':
      return 'errors.network';
    case 'timeout':
      return 'errors.timeout';
    case 'notConfigured':
      return 'errors.notConfigured';
    case 'noSession':
      return 'errors.sessionEnded';
    case 'invalidResponse':
      return 'errors.server';
    case 'cancelled':
      return 'errors.unexpected';
    case 'http':
      if (error.status === 429) return 'errors.tooManyRequests';
      if (error.status === 401) return 'errors.sessionEnded';
      if (error.status === 403) return 'errors.forbidden';
      if ((error.status ?? 0) >= 500) return 'errors.server';
      return 'errors.unexpected';
  }
}
