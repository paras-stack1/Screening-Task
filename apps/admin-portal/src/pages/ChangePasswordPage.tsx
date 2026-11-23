import { AUTH_ERROR_CODES } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { errorRule, isApiError } from '../api/errors';
import { useServices } from '../app/services';
import { changePasswordFormSchema, type ChangePasswordFormValues } from '../auth/validation';
import { Alert, Button, TextField } from '../components/ui';
import { errorMessageKey, useI18n, type TranslationKey } from '../i18n';

const POLICY_RULE_KEYS: Record<string, TranslationKey> = {
  TOO_SHORT: 'changePassword.errors.tooShort',
  TOO_LONG: 'changePassword.errors.tooLong',
  TOO_COMMON: 'changePassword.errors.tooCommon',
  CONTAINS_LOGIN_ID: 'changePassword.errors.containsLoginId',
  SAME_AS_CURRENT: 'changePassword.errors.sameAsCurrent',
};

const EMPTY: ChangePasswordFormValues = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * `forced`: the account must replace a temporary password before anything else (no navigation is
 * shown). Otherwise the signed-in administrator changes their password voluntarily.
 */
export function ChangePasswordPage({ forced }: { forced: boolean }) {
  const { t } = useI18n();
  const { session } = useServices();
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: EMPTY,
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setDone(false);
    try {
      await session.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset(EMPTY);
      setDone(true);
    } catch (error) {
      if (isApiError(error) && error.code === AUTH_ERROR_CODES.invalidCurrentPassword) {
        setError('currentPassword', { message: 'changePassword.errors.currentIncorrect' });
      } else if (isApiError(error) && error.code === AUTH_ERROR_CODES.passwordPolicy) {
        const key = POLICY_RULE_KEYS[errorRule(error) ?? ''];
        if (key) setError('newPassword', { message: key });
        else setServerError('errors.unexpected');
      } else {
        setServerError(errorMessageKey(error));
      }
    }
  });

  const form = (
    <>
      <h1>{t('changePassword.title')}</h1>
      <p className="muted">{t(forced ? 'changePassword.intro' : 'changePassword.voluntaryIntro')}</p>
      {done && <Alert tone="success">{t('changePassword.done')}</Alert>}
      {serverError && <Alert tone="error">{t(serverError)}</Alert>}
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextField
          label={t('changePassword.currentLabel')}
          type="password"
          autoComplete="current-password"
          errorKey={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <TextField
          label={t('changePassword.newLabel')}
          hint={t('changePassword.newHint')}
          type="password"
          autoComplete="new-password"
          errorKey={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <TextField
          label={t('changePassword.confirmLabel')}
          type="password"
          autoComplete="new-password"
          errorKey={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" busy={isSubmitting}>
          {isSubmitting ? t('changePassword.submitting') : t('changePassword.submit')}
        </Button>
      </form>
    </>
  );

  if (!forced) return <section className="card narrow">{form}</section>;
  return (
    <div className="auth-page">
      <main className="auth-card" id="main">
        <p className="brand">{t('app.name')}</p>
        {form}
        <Button variant="link" onClick={() => void session.logout()}>
          {t('common.signOut')}
        </Button>
      </main>
    </div>
  );
}
