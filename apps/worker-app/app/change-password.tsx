import { AppButton, AppCard, AppText, LanguageSelector, ScreenContainer } from '../src/components';
import { useAuth } from '../src/features/auth/AuthProvider';
import { ChangePasswordForm } from '../src/features/auth/components/ChangePasswordForm';
import { useTranslation } from '../src/localization';

/** Shown, and only reachable, while the account must change its password (decision O). */
export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const { logout } = useAuth();

  return (
    <ScreenContainer keyboardAware testID="change-password-screen">
      <LanguageSelector />
      <AppCard>
        <AppText variant="title" accessibilityRole="header">
          {t('auth.changePassword.title')}
        </AppText>
        <AppText color="textSecondary">{t('auth.changePassword.intro')}</AppText>
        <ChangePasswordForm />
      </AppCard>
      <AppButton variant="ghost" label={t('auth.signOut')} onPress={() => void logout()} />
    </ScreenContainer>
  );
}
