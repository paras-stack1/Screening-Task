import { ScrollView, StyleSheet, Text } from 'react-native';
import { AppCard } from '../src/components/AppCard';
import { ConnectionStatusCard } from '../src/components/ConnectionStatusCard';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { colors, spacing, typography } from '../src/constants/theme';
import { useApiHealth } from '../src/hooks/useApiHealth';
import { useTranslation } from '../src/hooks/useTranslation';

/**
 * Step 1 placeholder home screen. Proves that routing, theming, i18n and the
 * API connection work. Real screens (login, children, screening) come later.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const { state, retry } = useApiHealth();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <LanguageToggle />

      <AppCard>
        <Text style={styles.title} accessibilityRole="header">
          {t('appName')}
        </Text>
        <Text style={styles.tagline}>{t('tagline')}</Text>
      </AppCard>

      <AppCard style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>{t('screeningDisclaimer')}</Text>
      </AppCard>

      <ConnectionStatusCard state={state} onRetry={retry} />

      <Text style={styles.notice}>{t('foundationNotice')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.primary,
  },
  tagline: {
    fontSize: typography.body,
    color: colors.textSecondary,
  },
  disclaimer: {
    borderLeftWidth: 4,
    borderLeftColor: colors.secondary,
  },
  disclaimerText: {
    fontSize: typography.body,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  notice: {
    fontSize: typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
