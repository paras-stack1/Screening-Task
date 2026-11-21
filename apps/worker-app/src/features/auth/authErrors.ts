import { AUTH_ERROR_CODES } from '@balswasthya/shared-contracts';
import { isTranslationKey, type TranslationKey } from '../../localization';
import { apiErrorMessageKey } from '../../services/api/errorMessages';
import { errorRule, isApiError } from '../../services/api/errors';

/** Login failures. Every 401 has one generic message by design (no account enumeration). */
export function loginErrorKey(error: unknown): TranslationKey {
  if (isApiError(error) && error.kind === 'http' && (error.status === 401 || error.status === 400)) {
    return 'auth.login.errors.invalidCredentials';
  }
  return apiErrorMessageKey(error);
}

export type ChangePasswordField = 'currentPassword' | 'newPassword';

const POLICY_RULE_KEYS: Record<string, TranslationKey> = {
  TOO_SHORT: 'auth.changePassword.errors.tooShort',
  TOO_LONG: 'auth.changePassword.errors.tooLong',
  TOO_COMMON: 'auth.changePassword.errors.tooCommon',
  CONTAINS_LOGIN_ID: 'auth.changePassword.errors.containsLoginId',
  SAME_AS_CURRENT: 'auth.changePassword.errors.sameAsCurrent',
};

/** Password-change failures: field-level when the server says which field, else form-level. */
export function changePasswordErrorKey(error: unknown): { field?: ChangePasswordField; key: TranslationKey } {
  if (isApiError(error) && error.status === 400) {
    if (error.code === AUTH_ERROR_CODES.invalidCurrentPassword) {
      return { field: 'currentPassword', key: 'auth.changePassword.errors.currentIncorrect' };
    }
    if (error.code === AUTH_ERROR_CODES.passwordPolicy) {
      const rule = errorRule(error);
      return {
        field: 'newPassword',
        key: (rule && POLICY_RULE_KEYS[rule]) || 'auth.changePassword.errors.tooCommon',
      };
    }
  }
  return { key: apiErrorMessageKey(error) };
}

/** Translates a validation message produced by the form schemas (they are translation keys). */
export function validationMessageKey(message: string | undefined): TranslationKey | undefined {
  if (!message) return undefined;
  return isTranslationKey(message) ? message : 'errors.unexpected';
}
