import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, Card, Screen, T } from '../../src/components/ui';
import { errorKey, useI18n, type TranslationKey } from '../../src/i18n';
import { useSession } from '../../src/session/SessionProvider';
import { colors } from '../../src/theme';

/** Account & security settings (brief screen 10). */
export default function SettingsScreen() {
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();
  const { state, signOut, signOutEverywhere } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  if (state.status !== 'signedIn') return null;
  const { account } = state;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorKey(e));
      setBusy(false);
    }
  };

  return (
    <Screen title={t('settings.title')} back testID="settings-screen">
      <Card>
        <T variant="small" color={colors.textSecondary}>
          {t('settings.name')}
        </T>
        <T variant="large">{account.guardianName}</T>
        <T variant="small" color={colors.textSecondary}>
          {t('settings.phone')}
        </T>
        <T variant="large" testID="settings-phone">
          {account.maskedPhone}
        </T>
        <T variant="small">{t('settings.privacy', { version: account.privacyNoticeVersion })}</T>
      </Card>
      <Button
        label={t('settings.changePassword')}
        variant="secondary"
        icon="lock-reset"
        onPress={() => router.push('/change-password')}
        testID="settings-change-password"
      />
      <Button
        label={t('settings.changePhone')}
        variant="secondary"
        icon="cellphone-key"
        onPress={() => router.push('/change-phone')}
        testID="settings-change-phone"
      />
      <Button
        label={`${t('settings.language')}: ${language === 'hi' ? 'English' : 'हिंदी'}`}
        variant="secondary"
        icon="translate"
        onPress={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
      />
      {error ? <Alert message={t(error)} /> : null}
      <Button
        label={t('settings.signOut')}
        variant="danger"
        icon="logout"
        onPress={() => run(signOut)}
        disabled={busy}
        testID="settings-sign-out"
      />
      <Button
        label={t('settings.signOutAll')}
        variant="ghost"
        onPress={() => run(signOutEverywhere)}
        disabled={busy}
        testID="settings-sign-out-all"
      />
    </Screen>
  );
}
