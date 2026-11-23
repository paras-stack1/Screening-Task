import { AUTH_ERROR_CODES } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { isApiError } from '../api/errors';
import { useServices } from '../app/services';
import type { SessionEndReason } from '../auth/sessionManager';
import { loginFormSchema, type LoginFormValues } from '../auth/validation';
import { LanguageSelect } from '../components/LanguageSelect';
import { Alert, Button, TextField } from '../components/ui';
import { errorMessageKey, useI18n, type TranslationKey } from '../i18n';

function loginErrorKey(error: unknown): TranslationKey {
  if (isApiError(error) && error.status === 401 && error.code === AUTH_ERROR_CODES.invalidCredentials) {
    return 'login.errors.invalidCredentials';
  }
  return errorMessageKey(error);
}

export function LoginPage({ reason }: { reason?: SessionEndReason }) {
  const { t } = useI18n();
  const { session } = useServices();
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { loginId: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await session.login(values.loginId, values.password);
    } catch (error) {
      setServerError(loginErrorKey(error));
      // Never keep a rejected password in the form.
      resetField('password');
    }
  });

  return (
    <div className="auth-page">
      <main className="auth-card" id="main">
        <div className="auth-top">
          <div>
            <p className="brand">{t('app.name')}</p>
            <h1>{t('login.title')}</h1>
            <p className="muted">{t('login.subtitle')}</p>
          </div>
          <LanguageSelect />
        </div>

        {reason === 'loggedOut' && !serverError && <Alert tone="info">{t('login.signedOut')}</Alert>}
        {reason === 'sessionEnded' && !serverError && (
          <Alert tone="warning">{t('errors.sessionEnded')}</Alert>
        )}
        {serverError && (
          <Alert tone="error" testId="login-error">
            {t(serverError)}
          </Alert>
        )}

        <form onSubmit={(event) => void onSubmit(event)} noValidate>
          <TextField
            label={t('login.loginIdLabel')}
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
            errorKey={errors.loginId?.message}
            {...register('loginId')}
          />
          <TextField
            label={t('login.passwordLabel')}
            type="password"
            autoComplete="current-password"
            errorKey={errors.password?.message}
            {...register('password')}
          />
          <Button type="submit" busy={isSubmitting}>
            {isSubmitting ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
        <p className="muted small">{t('login.forgotPassword')}</p>
      </main>
    </div>
  );
}
