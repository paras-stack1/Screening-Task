import Constants from 'expo-constants';
import { useState } from 'react';
import {
  AppButton,
  AppCard,
  AppText,
  ConfirmationDialog,
  LanguageSelector,
  ScreenContainer,
  SectionHeader,
} from '../../src/components';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { useTranslation } from '../../src/localization';

/** Settings: language, about, privacy, sign out (decision P: this device only). */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const version = Constants.expoConfig?.version;

  const signOut = () => {
    setSigningOut(true);
    // Local credentials are cleared at once; the navigator then leaves this screen.
    logout().catch(() => undefined);
  };

  return (
    <ScreenContainer edges={['left', 'right']} testID="settings-screen">
      <AppCard>
        <SectionHeader title={t('language.label')} />
        <LanguageSelector layout="full" />
      </AppCard>

      <AppCard>
        <SectionHeader title={t('settings.privacy.title')} />
        <AppText>{t('settings.privacy.body')}</AppText>
      </AppCard>

      <AppCard>
        <SectionHeader title={t('settings.about.title')} />
        <AppText>{t('app.name')}</AppText>
        {version ? (
          <AppText color="textSecondary" testID="app-version">
            {t('settings.about.version', { version })}
          </AppText>
        ) : null}
        <AppText variant="bodySmall" color="textSecondary">
          {t('app.screeningDisclaimer')}
        </AppText>
      </AppCard>

      <AppButton
        variant="secondary"
        icon="logout"
        label={t('auth.signOut')}
        onPress={() => setConfirming(true)}
        testID="settings-sign-out"
      />

      <ConfirmationDialog
        visible={confirming}
        title={t('settings.logoutConfirm.title')}
        message={t('settings.logoutConfirm.message')}
        confirmLabel={t('auth.signOut')}
        destructive
        confirming={signingOut}
        onConfirm={signOut}
        onCancel={() => setConfirming(false)}
      />
    </ScreenContainer>
  );
}
