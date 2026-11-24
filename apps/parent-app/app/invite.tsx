import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { isApiError } from '../src/api/http';
import { Alert, Button, Card, Loading, Screen, T } from '../src/components/ui';
import { errorKey, useI18n, type TranslationKey } from '../src/i18n';
import { readInviteToken } from '../src/inviteToken';
import { useServices } from '../src/services';
import { useOnboarding } from '../src/session/OnboardingProvider';
import { colors } from '../src/theme';

/**
 * Invitation landing (brief screen 1). Shows only the masked number - no names or child details
 * before the parent has verified it is them.
 */
export default function InviteScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { api } = useServices();
  const onboarding = useOnboarding();
  const [phase, setPhase] = useState<'checking' | 'ready' | 'invalid' | 'noToken'>('checking');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const token = (await readInviteToken()) ?? onboarding.token;
      if (!token) {
        if (active) setPhase('noToken');
        return;
      }
      try {
        const result = await api.validateInvitation(token);
        if (!active) return;
        onboarding.setInvitation(token, result.maskedPhone);
        setPhase('ready');
      } catch (e) {
        if (!active) return;
        if (isApiError(e) && e.code === 'INVITATION_INVALID') setPhase('invalid');
        else {
          setError(errorKey(e));
          setPhase('invalid');
        }
      }
    })();
    return () => {
      active = false;
    };
    // Runs once per opening of the link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    if (!onboarding.token || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.sendCode(onboarding.token);
      router.push('/verify');
    } catch (e) {
      setError(
        errorKey(e, { OTP_RESEND_TOO_SOON: 'invite.waitResend', INVITATION_INVALID: 'invite.invalidBody' }),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen title={t('app.name')} testID="invite-screen">
      <T variant="title">{t('invite.title')}</T>
      <T>{t('invite.intro')}</T>
      {phase === 'checking' ? <Loading label={t('invite.checking')} /> : null}
      {phase === 'noToken' ? (
        <Alert tone="info" message={t('invite.noToken')} testID="invite-no-token" />
      ) : null}
      {phase === 'invalid' ? (
        <Card testID="invite-invalid">
          <T variant="large" color={colors.danger}>
            {t('invite.invalidTitle')}
          </T>
          <T>{error ? t(error) : t('invite.invalidBody')}</T>
        </Card>
      ) : null}
      {phase === 'ready' ? (
        <>
          <Card>
            <T color={colors.textSecondary}>{t('invite.codeTo')}</T>
            <T variant="title" testID="invite-phone">
              {onboarding.maskedPhone}
            </T>
          </Card>
          {error ? <Alert message={t(error)} testID="invite-error" /> : null}
          <Button
            label={t('invite.sendCode')}
            onPress={send}
            loading={sending}
            icon="message-text-outline"
            testID="invite-send-code"
          />
        </>
      ) : null}
      <Button label={t('login.title')} variant="ghost" onPress={() => router.replace('/login')} />
    </Screen>
  );
}
