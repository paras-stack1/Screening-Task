import { StyleSheet, View } from 'react-native';
import { AppCard, AppIcon, AppText, InlineAlert, LanguageSelector, ScreenContainer } from '../src/components';
import { useAuth } from '../src/features/auth/AuthProvider';
import { LoginForm } from '../src/features/auth/components/LoginForm';
import { useTranslation } from '../src/localization';
import { colors, spacing } from '../src/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const reason = state.status === 'unauthenticated' ? state.reason : undefined;

  return (
    <ScreenContainer keyboardAware testID="login-screen">
      <LanguageSelector />

      <View style={styles.brand}>
        <View style={styles.logo}>
          <AppIcon name="heart-pulse" size="lg" color={colors.textOnPrimary} />
        </View>
        <AppText variant="display" color="primary" align="center" accessibilityRole="header">
          {t('app.name')}
        </AppText>
        <AppText color="textSecondary" align="center">
          {t('app.tagline')}
        </AppText>
      </View>

      <AppCard style={styles.card}>
        <AppText variant="title" accessibilityRole="header">
          {t('auth.login.title')}
        </AppText>
        <AppText color="textSecondary">{t('auth.login.subtitle')}</AppText>
        {reason === 'sessionEnded' ? (
          <InlineAlert tone="info" message={t('errors.sessionEnded')} testID="session-ended-notice" />
        ) : null}
        {reason === 'loggedOut' ? <InlineAlert tone="info" message={t('auth.loggedOut')} /> : null}
        <LoginForm />
      </AppCard>

      <AppText variant="caption" color="textSecondary" align="center">
        {t('app.screeningDisclaimer')}
      </AppText>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  card: { padding: spacing.lg, gap: spacing.md },
});
