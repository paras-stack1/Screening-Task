import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View, StyleSheet } from 'react-native';
import { AppInput, AppText, InlineAlert, PasswordInput, PrimaryButton } from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { spacing } from '../../../theme';
import { useAuth } from '../AuthProvider';
import { loginErrorKey, validationMessageKey } from '../authErrors';
import { loginFormSchema, type LoginFormValues } from '../validation/schemas';

/**
 * Sign-in form. On success nothing navigates here: the session state changes and the root
 * navigator's guards move to the app. The password lives only in form state while this screen
 * is mounted and is never logged or stored.
 */
export function LoginForm() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  // State updates are asynchronous; the ref blocks a second submission immediately.
  const inFlight = useRef(false);

  const {
    control,
    handleSubmit,
    setFocus,
    resetField,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { loginId: '', password: '' },
  });

  const onValid = async ({ loginId, password }: LoginFormValues) => {
    setSubmitting(true);
    setServerError(null);
    try {
      await login(loginId, password);
    } catch (error) {
      const key = loginErrorKey(error);
      setServerError(key);
      if (key === 'auth.login.errors.invalidCredentials') resetField('password');
    } finally {
      setSubmitting(false);
    }
  };

  /** Event handler only (never called during render). Guards validation and the request. */
  const submit = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    handleSubmit(onValid)()
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
      });
  };

  const fieldError = (message?: string) => {
    const key = validationMessageKey(message);
    return key ? t(key) : undefined;
  };

  return (
    <View style={styles.form}>
      {serverError ? <InlineAlert message={t(serverError)} testID="login-error" /> : null}

      <Controller
        control={control}
        name="loginId"
        render={({ field }) => (
          <AppInput
            ref={field.ref}
            label={t('auth.login.loginIdLabel')}
            hint={t('auth.login.loginIdHint')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldError(errors.loginId?.message)}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => setFocus('password')}
            editable={!submitting}
            testID="login-id"
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <PasswordInput
            ref={field.ref}
            label={t('auth.login.passwordLabel')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldError(errors.password?.message)}
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!submitting}
            testID="login-password"
          />
        )}
      />

      <PrimaryButton
        label={t('auth.login.submit')}
        onPress={submit}
        loading={submitting}
        testID="login-submit"
      />

      <AppText variant="bodySmall" color="textSecondary" align="center">
        {t('auth.login.forgotPassword')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
});
