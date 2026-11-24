import type { ParentLegalResponse } from '@balswasthya/shared-contracts';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { isApiError } from '../src/api/http';
import { Alert, Button, Card, Checkbox, Field, Loading, Screen, T } from '../src/components/ui';
import { errorKey, useI18n, type TranslationKey } from '../src/i18n';
import { useServices } from '../src/services';
import { useOnboarding } from '../src/session/OnboardingProvider';
import { colors } from '../src/theme';

/**
 * Create password + privacy notice + terms (brief screen 4). The parent chooses their own password;
 * accepting the documents grants no consent for health data (shown on screen).
 */
export default function CreatePasswordScreen() {
  const { t, language } = useI18n();
  const router = useRouter();
  const { api } = useServices();
  const onboarding = useOnboarding();
  const [legal, setLegal] = useState<ParentLegalResponse | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [fieldError, setFieldError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .legal(language)
      .then(setLegal)
      .catch((e: unknown) => setError(errorKey(e)));
  }, [api, language]);

  if (!onboarding.token || !onboarding.ticket) return <Redirect href="/invite" />;

  const submit = async () => {
    setError(null);
    setFieldError(null);
    if (password.length < 8) return setFieldError('password.weak');
    if (password !== confirm) return setFieldError('password.mismatch');
    if (!privacy || !terms) return setError('password.mustAccept');
    if (!legal) return;
    setBusy(true);
    try {
      const result = await api.activate({
        token: onboarding.token!,
        activationTicket: onboarding.ticket!,
        password,
        confirmPassword: confirm,
        privacyNoticeVersion: legal.privacyNotice.version,
        termsVersion: legal.terms.version,
        acceptPrivacyNotice: true,
        acceptTerms: true,
      });
      onboarding.reset();
      router.replace({ pathname: '/activated', params: { phone: result.maskedPhone } });
    } catch (e) {
      if (isApiError(e) && e.code === 'WEAK_PASSWORD') setFieldError('password.weak');
      else
        setError(
          errorKey(e, {
            PHONE_NOT_VERIFIED: 'password.notVerified',
            LEGAL_VERSION_CHANGED: 'password.legalChanged',
            ACCOUNT_EXISTS: 'password.accountExists',
            LEGAL_TEXT_NOT_APPROVED: 'password.legalNotApproved',
            INVITATION_INVALID: 'invite.invalidBody',
          }),
        );
    } finally {
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  };

  return (
    <Screen title={t('password.title')} testID="create-password-screen">
      <T>{t('password.intro')}</T>
      <Field
        label={t('password.new')}
        value={password}
        onChangeText={setPassword}
        secure
        hint={t('password.rules')}
        testID="password-new"
      />
      <Field
        label={t('password.confirm')}
        value={confirm}
        onChangeText={setConfirm}
        secure
        error={fieldError ? t(fieldError) : null}
        testID="password-confirm"
      />
      {legal ? (
        <>
          {[legal.privacyNotice, legal.terms].map((doc) => (
            <Card key={doc.kind} testID={`legal-${doc.kind}`}>
              <T variant="large">{doc.title}</T>
              {doc.isPlaceholder ? <Alert tone="warning" message={t('password.draft')} /> : null}
              <T variant="small">{doc.text}</T>
            </Card>
          ))}
          <T variant="small" color={colors.primaryDark}>
            {t('password.noConsent')}
          </T>
          <Checkbox
            label={t('password.acceptPrivacy')}
            checked={privacy}
            onChange={setPrivacy}
            testID="accept-privacy"
          />
          <Checkbox
            label={t('password.acceptTerms')}
            checked={terms}
            onChange={setTerms}
            testID="accept-terms"
          />
        </>
      ) : (
        <Loading label={t('common.loading')} />
      )}
      {error ? <Alert message={t(error)} testID="create-password-error" /> : null}
      <Button
        label={t('password.create')}
        onPress={submit}
        loading={busy}
        disabled={!legal}
        testID="create-account"
      />
    </Screen>
  );
}
