import { normalizeIndianMobile } from '@balswasthya/shared-contracts';
import { useState } from 'react';
import { Alert, Button, Field, Screen, T } from '../../src/components/ui';
import { errorKey, useI18n, type TranslationKey } from '../../src/i18n';
import { useServices } from '../../src/services';
import { useSession } from '../../src/session/SessionProvider';

/** Mobile number change (PP14): password + a code sent to the NEW number. */
export default function ChangePhoneScreen() {
  const { t } = useI18n();
  const { api } = useServices();
  const { withToken, setAccount } = useSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<TranslationKey | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const codes = {
    CURRENT_PASSWORD_WRONG: 'changePassword.wrongCurrent',
    SAME_PHONE: 'changePhone.same',
    PHONE_IN_USE: 'changePhone.inUse',
    OTP_INVALID: 'forgot.invalidCode',
    OTP_RESEND_TOO_SOON: 'invite.waitResend',
  } as const;

  const start = async () => {
    setError(null);
    const normalized = normalizeIndianMobile(phone);
    if (!normalized) return setError('errors.phoneFormat');
    setBusy(true);
    try {
      await withToken((token) => api.startPhoneChange(token, normalized, password));
      setPending(normalized);
    } catch (e) {
      setError(errorKey(e, codes));
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  const confirm = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError('otp.format');
    setBusy(true);
    try {
      const result = await withToken((token) => api.confirmPhoneChange(token, pending!, code));
      setAccount(result.account);
      setDone(true);
    } catch (e) {
      setError(errorKey(e, codes));
    } finally {
      setCode('');
      setBusy(false);
    }
  };

  return (
    <Screen title={t('changePhone.title')} back testID="change-phone-screen">
      {done ? (
        <Alert tone="success" message={t('changePhone.done')} testID="change-phone-done" />
      ) : pending ? (
        <>
          <T>{t('otp.intro', { phone: pending })}</T>
          <Field
            label={t('otp.label')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            testID="change-phone-code"
          />
          {error ? <Alert message={t(error)} testID="change-phone-error" /> : null}
          <Button
            label={t('changePhone.confirm')}
            onPress={confirm}
            loading={busy}
            testID="change-phone-confirm"
          />
        </>
      ) : (
        <>
          <T>{t('changePhone.intro')}</T>
          <Field
            label={t('changePhone.newPhone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            testID="change-phone-new"
          />
          <Field
            label={t('changePassword.current')}
            value={password}
            onChangeText={setPassword}
            secure
            testID="change-phone-password"
          />
          {error ? <Alert message={t(error)} testID="change-phone-error" /> : null}
          <Button
            label={t('changePhone.sendCode')}
            onPress={start}
            loading={busy}
            testID="change-phone-start"
          />
        </>
      )}
    </Screen>
  );
}
