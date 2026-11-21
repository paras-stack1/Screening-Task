import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { InlineAlert, PasswordInput, PrimaryButton } from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { spacing } from '../../../theme';
import { useAuth } from '../AuthProvider';
import { changePasswordErrorKey, validationMessageKey } from '../authErrors';
import { changePasswordFormSchema, type ChangePasswordFormValues } from '../validation/schemas';

/**
 * Forced password change (decision O). On success the session receives new tokens with
 * mustChangePassword = false and the navigator moves on to the app.
 */
export function ChangePasswordForm() {
  const { t } = useTranslation();
  const { changePassword } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const {
    control,
    handleSubmit,
    setFocus,
    setError,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onValid = async ({ currentPassword, newPassword }: ChangePasswordFormValues) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await changePassword({ currentPassword, newPassword });
    } catch (error) {
      const { field, key } = changePasswordErrorKey(error);
      if (field) setError(field, { message: key });
      else setFormError(key);
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
      {formError ? <InlineAlert message={t(formError)} testID="change-password-error" /> : null}

      <Controller
        control={control}
        name="currentPassword"
        render={({ field }) => (
          <PasswordInput
            ref={field.ref}
            label={t('auth.changePassword.currentLabel')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldError(errors.currentPassword?.message)}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => setFocus('newPassword')}
            editable={!submitting}
          />
        )}
      />
      <Controller
        control={control}
        name="newPassword"
        render={({ field }) => (
          <PasswordInput
            ref={field.ref}
            label={t('auth.changePassword.newLabel')}
            hint={t('auth.changePassword.newHint')}
            autoComplete="new-password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldError(errors.newPassword?.message)}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => setFocus('confirmPassword')}
            editable={!submitting}
          />
        )}
      />
      <Controller
        control={control}
        name="confirmPassword"
        render={({ field }) => (
          <PasswordInput
            ref={field.ref}
            label={t('auth.changePassword.confirmLabel')}
            autoComplete="new-password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldError(errors.confirmPassword?.message)}
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!submitting}
          />
        )}
      />

      <PrimaryButton
        label={t('auth.changePassword.submit')}
        onPress={submit}
        loading={submitting}
        testID="change-password-submit"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
});
