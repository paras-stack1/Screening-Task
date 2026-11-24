import { normalizeIndianMobile } from '@balswasthya/shared-contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { isApiError } from '../src/api/http';
import { Alert, Button, Field, Screen, T } from '../src/components/ui';
import { errorKey, useI18n, type TranslationKey } from '../src/i18n';
import { useServices } from '../src/services';

/**
 * Forgot password (brief screen 7). The screen never says whether the number has an account:
 * the same message follows every request.
 */
export default function ForgotPasswordScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { api } = useServices();
  const [phone, setPhone] = useState('');
  const [normalized, setNormalized] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const send = async () => {
    setError(null);
    const value = normalizeIndianMobile(phone);
    if (!value) return setError('errors.phoneFormat');
    setBusy(true);
    try {
      await api.forgotPassword(value);
      setNormalized(value);
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError('otp.format');
    if (password !== confirm) return setError('password.mismatch');
    setBusy(true);
    try {
      await api.resetPassword(normalized!, code, password, confirm);
      setDone(true);
    } catch (e) {
      if (isApiError(e) && e.code === 'WEAK_PASSWORD') setError('password.weak');
      else setError(errorKey(e, { RESET_INVALID: 'forgot.invalidCode' }));
    } finally {
      setCode('');
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  };

  return (
    <Screen title={t('forgot.title')} back testID="forgot-screen">
      {done ? (
        <>
          <Alert tone="success" message={t('forgot.done')} testID="forgot-done" />
          <Button label={t('login.submit')} onPress={() => router.replace('/login')} />
        </>
      ) : normalized ? (
        <>
          <Alert tone="info" message={t('forgot.sent')} testID="forgot-sent" />
          <Field
            label={t('forgot.code')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            testID="forgot-code"
          />
          <Field
            label={t('password.new')}
            value={password}
            onChangeText={setPassword}
            secure
            hint={t('password.rules')}
            testID="forgot-password"
          />
          <Field
            label={t('password.confirm')}
            value={confirm}
            onChangeText={setConfirm}
            secure
            testID="forgot-confirm"
          />
          {error ? <Alert message={t(error)} testID="forgot-error" /> : null}
          <Button label={t('forgot.reset')} onPress={reset} loading={busy} testID="forgot-reset" />
        </>
      ) : (
        <>
          <T>{t('forgot.intro')}</T>
          <Field
            label={t('login.phone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            testID="forgot-phone"
          />
          {error ? <Alert message={t(error)} testID="forgot-error" /> : null}
          <Button label={t('forgot.send')} onPress={send} loading={busy} testID="forgot-send" />
        </>
      )}
    </Screen>
  );
}
