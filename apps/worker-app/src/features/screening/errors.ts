import type { TranslationKey } from '../../localization';
import { apiErrorMessageKey } from '../../services/api/errorMessages';
import { isApiError } from '../../services/api/errors';

/** Server codes the worker can act on, mapped to plain-language messages (never server text). */
const SESSION_ERRORS: Record<string, TranslationKey> = {
  VERSION_CONFLICT: 'screening.errors.versionConflict',
  INTEGRITY_RULE_VIOLATION: 'screening.errors.versionConflict',
  TRANSACTION_CONFLICT: 'screening.errors.versionConflict',
  SESSION_FINAL: 'screening.errors.sessionFinal',
  NOT_SESSION_OWNER: 'screening.errors.notOwner',
  CONSENT_REQUIRED: 'screening.errors.consent',
  CATEGORY_NOT_AVAILABLE: 'screening.errors.categoryNotAvailable',
  CATEGORY_ALREADY_STARTED: 'screening.errors.categoryAlreadyStarted',
  CATEGORY_NOT_STARTED: 'screening.errors.categoryNotAvailable',
  CATEGORY_COMPLETED: 'screening.errors.categoryCompleted',
  PROTOCOL_INTEGRITY_ERROR: 'screening.errors.protocolIntegrity',
  REQUIRED_QUESTIONS_MISSING: 'screening.errors.requiredMissing',
  NO_COMPLETED_CATEGORY: 'screening.review.needOneFinished',
  INVALID_RESPONSE: 'screening.errors.invalidAnswer',
  QUESTION_NOT_IN_PROTOCOL: 'screening.errors.invalidAnswer',
  MEASUREMENT_ALREADY_CORRECTED: 'screening.errors.alreadyCorrected',
  INVALID_UNIT: 'screening.measurement.errors.unit',
  TOO_MANY_DECIMALS: 'screening.measurement.errors.decimals',
  IMPLAUSIBLE_VALUE: 'screening.measurement.errors.implausible',
  MEASURED_IN_FUTURE: 'screening.measurement.errors.future',
  MEASURED_BEFORE_BIRTH: 'screening.measurement.errors.beforeBirth',
};

export function sessionErrorKey(error: unknown): TranslationKey {
  return (isApiError(error) && error.code && SESSION_ERRORS[error.code]) || apiErrorMessageKey(error);
}

/** A stale write: the screen should reload the session (local unsaved answers are kept). */
export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && (error.code === 'VERSION_CONFLICT' || error.code === 'TRANSACTION_CONFLICT');
}
