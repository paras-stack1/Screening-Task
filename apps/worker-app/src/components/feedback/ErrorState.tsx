import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../localization';
import { colors, spacing } from '../../theme';
import { AppButton } from '../buttons/AppButton';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';

interface ErrorStateProps {
  /** Must be a translated, user-safe message - never a raw server or exception message. */
  title?: string;
  message?: string;
  onRetry?: () => void;
  /** True while the retry is running: shows a spinner and blocks repeated taps. */
  retrying?: boolean;
  testID?: string;
}

export function ErrorState({ title, message, onRetry, retrying = false, testID }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.container} accessibilityLiveRegion="polite" testID={testID}>
      <View style={styles.iconCircle}>
        <AppIcon name="alert-circle-outline" size="lg" color={colors.danger} />
      </View>
      <AppText variant="subtitle" align="center" accessibilityRole="header">
        {title ?? t('common.error.title')}
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {message ?? t('common.error.message')}
      </AppText>
      {onRetry ? (
        <AppButton
          variant="secondary"
          icon="sync"
          label={t('common.retry')}
          onPress={onRetry}
          loading={retrying}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.dangerSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
