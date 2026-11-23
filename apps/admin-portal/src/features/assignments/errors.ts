import { isApiError } from '../../api/errors';
import { errorMessageKey, type TranslationKey } from '../../i18n';

/** Maps assignment refusals to specific messages; everything else to the generic ones. */
export function assignmentErrorKey(error: unknown): TranslationKey {
  if (!isApiError(error)) return 'errors.unexpected';
  switch (error.code) {
    case 'ASSIGNMENT_OVERLAP':
      return 'assignment.errors.overlap';
    case 'SELF_MODIFICATION':
      return 'assignment.errors.self';
    case 'OUT_OF_SCOPE':
      return 'create.errors.outOfScope';
    case 'ROLE_EXCEEDS_OWN_PERMISSIONS':
      return 'create.errors.roleTooHigh';
    case 'INVALID_TRANSITION':
    case 'CONCURRENT_CHANGE':
      return 'action.errors.conflict';
  }
  if (error.status === 404) return 'assignment.errors.notFound';
  if (error.status === 400) return 'assignment.errors.dates';
  return errorMessageKey(error);
}
