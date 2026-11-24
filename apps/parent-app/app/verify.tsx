import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { isApiError } from '../src/api/http';
import { Alert, Button, Field, Screen, T } from '../src/components/ui';
import { errorKey, useI18n } from '../src/i18n';
import { useServices } from '../src/services';
import { useOnboarding } from '../src/session/OnboardingProvider';

const RESEND_SECONDS = 60;

/** Mobile verification + OTP entry (brief screens 2-3). */
export default function VerifyScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { api } = useServices();
  const onboarding = useOnboarding();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  if (!onboarding.token) return <Redirect href="/invite" />;
  const token = onboarding.token;

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setMessage(t('otp.format'));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.verifyCode(token, code);
      onboarding.setTicket(result.activationTicket);
      setCode('');
      router.replace('/create-password');
    } catch (e) {
      setCode('');
      if (isApiError(e) && e.code === 'OTP_INVALID') {
        const left = (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft ?? 0;
        setMessage(left > 0 ? t('otp.wrong', { left }) : t('otp.expired'));
      } else if (isApiError(e) && e.code === 'OTP_EXPIRED') setMessage(t('otp.expired'));
      else setMessage(t(errorKey(e, { INVITATION_INVALID: 'invite.invalidBody' })));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.sendCode(token);
      setWait(RESEND_SECONDS);
    } catch (e) {
      setMessage(
        t(
          errorKey(e, { OTP_RESEND_TOO_SOON: 'invite.waitResend', INVITATION_INVALID: 'invite.invalidBody' }),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('otp.title')} back testID="verify-screen">
      <T>{t('otp.intro', { phone: onboarding.maskedPhone ?? '' })}</T>
      <Field
        label={t('otp.label')}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        testID="otp-code"
      />
      {message ? <Alert message={message} testID="otp-message" /> : null}
      <Button label={t('otp.verify')} onPress={verify} loading={busy} testID="otp-verify" />
      {wait > 0 ? (
        <T variant="small">{t('otp.resendIn', { seconds: wait })}</T>
      ) : (
        <Button
          label={t('otp.resend')}
          variant="secondary"
          onPress={resend}
          disabled={busy}
          testID="otp-resend"
        />
      )}
    </Screen>
  );
}
