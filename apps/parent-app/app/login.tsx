import { normalizeIndianMobile } from '@balswasthya/shared-contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { isApiError } from '../src/api/http';
import { Alert, Button, Field, Screen, T } from '../src/components/ui';
import { errorKey, useI18n, type TranslationKey } from '../src/i18n';
import { useSession } from '../src/session/SessionProvider';
import { colors } from '../src/theme';

/** Parent login (brief screen 6): mobile number + password, forgot password, help. */
export default function LoginScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { signIn, state } = useSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState<TranslationKey | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const expired = state.status === 'signedOut' && state.reason === 'expired';

  const submit = async () => {
    setError(null);
    const normalized = normalizeIndianMobile(phone);
    setPhoneError(normalized ? null : 'errors.phoneFormat');
    if (!normalized) return;
    if (!password) return setError('errors.required');
    setBusy(true);
    try {
      await signIn(normalized, password);
    } catch (e) {
      setError(isApiError(e) && e.status === 401 ? 'login.invalid' : errorKey(e));
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Screen title={t('app.name')} testID="login-screen">
      <T variant="title">{t('login.title')}</T>
      <T>{t('login.welcome')}</T>
      {expired ? <Alert tone="info" message={t('login.expired')} /> : null}
      <Field
        label={t('login.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        error={phoneError ? t(phoneError) : null}
        testID="login-phone"
      />
      <Field
        label={t('login.password')}
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="current-password"
        testID="login-password"
      />
      {error ? <Alert message={t(error)} testID="login-error" /> : null}
      <Button label={t('login.submit')} onPress={submit} loading={busy} icon="login" testID="login-submit" />
      <Button
        label={t('login.forgot')}
        variant="ghost"
        onPress={() => router.push('/forgot-password')}
        testID="login-forgot"
      />
      <T variant="small" color={colors.textSecondary}>
        {t('login.invited')}
      </T>
      <T variant="small" color={colors.textSecondary}>
        {t('login.help')}
      </T>
    </Screen>
  );
}
