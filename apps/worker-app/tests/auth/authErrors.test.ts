import {
  changePasswordErrorKey,
  loginErrorKey,
  validationMessageKey,
} from '../../src/features/auth/authErrors';
import {
  changePasswordFormSchema,
  loginFormSchema,
  passwordCharCount,
} from '../../src/features/auth/validation/schemas';
import { isTranslationKey } from '../../src/localization';
import { ApiError } from '../../src/services/api/errors';

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe('form schemas', () => {
  it('every validation message is a translation key', () => {
    const all = [
      ...messages(loginFormSchema.safeParse({ loginId: '', password: '' })),
      ...messages(loginFormSchema.safeParse({ loginId: 'x'.repeat(65), password: 'x'.repeat(1025) })),
      ...messages(
        changePasswordFormSchema.safeParse({ currentPassword: '', newPassword: 'a', confirmPassword: 'b' }),
      ),
      ...messages(
        changePasswordFormSchema.safeParse({
          currentPassword: 'x',
          newPassword: 'y'.repeat(129),
          confirmPassword: '',
        }),
      ),
      ...messages(
        changePasswordFormSchema.safeParse({
          currentPassword: 'same pass',
          newPassword: 'same pass',
          confirmPassword: 'same pass',
        }),
      ),
    ];
    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const message of all) expect(isTranslationKey(message)).toBe(true);
  });

  it('trims the login ID but never the password', () => {
    expect(loginFormSchema.parse({ loginId: '  EMP-1 ', password: ' secret ' })).toEqual({
      loginId: 'EMP-1',
      password: ' secret ',
    });
  });

  it('counts Hindi characters as the server does', () => {
    expect(passwordCharCount('मेरी बेटी')).toBe(Array.from('मेरी बेटी'.normalize('NFKC')).length);
    expect(
      changePasswordFormSchema.safeParse({
        currentPassword: 'old',
        newPassword: 'मेरी प्यारी बेटी',
        confirmPassword: 'मेरी प्यारी बेटी',
      }).success,
    ).toBe(true);
  });

  it('unknown messages fall back to a generic key', () => {
    expect(validationMessageKey('Some raw zod message')).toBe('errors.unexpected');
    expect(validationMessageKey(undefined)).toBeUndefined();
  });
});

describe('error mapping', () => {
  it('maps every login 401/400 to the single generic message', () => {
    for (const status of [400, 401]) {
      expect(loginErrorKey(new ApiError('http', { status, code: 'INVALID_CREDENTIALS' }))).toBe(
        'auth.login.errors.invalidCredentials',
      );
    }
    expect(loginErrorKey(new ApiError('network'))).toBe('errors.network');
  });

  it.each([
    ['TOO_SHORT', 'auth.changePassword.errors.tooShort'],
    ['TOO_LONG', 'auth.changePassword.errors.tooLong'],
    ['TOO_COMMON', 'auth.changePassword.errors.tooCommon'],
    ['CONTAINS_LOGIN_ID', 'auth.changePassword.errors.containsLoginId'],
    ['SAME_AS_CURRENT', 'auth.changePassword.errors.sameAsCurrent'],
    ['SOMETHING_NEW', 'auth.changePassword.errors.tooCommon'],
  ])('password policy rule %s -> %s', (rule, key) => {
    const error = new ApiError('http', { status: 400, code: 'PASSWORD_POLICY', details: { rule } });
    expect(changePasswordErrorKey(error)).toEqual({ field: 'newPassword', key });
  });

  it('wrong current password is reported on that field', () => {
    const error = new ApiError('http', { status: 400, code: 'INVALID_CURRENT_PASSWORD' });
    expect(changePasswordErrorKey(error)).toEqual({
      field: 'currentPassword',
      key: 'auth.changePassword.errors.currentIncorrect',
    });
  });

  it('other failures are form-level', () => {
    expect(changePasswordErrorKey(new ApiError('http', { status: 429 }))).toEqual({
      key: 'errors.tooManyRequests',
    });
  });
});
