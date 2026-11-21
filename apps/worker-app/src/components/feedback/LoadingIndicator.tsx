import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../localization';
import { colors, spacing } from '../../theme';
import { AppText } from '../common/AppText';

interface LoadingIndicatorProps {
  /** Visible and spoken text. Defaults to "Loading…". */
  label?: string;
  /** Fills and centres in the available space (whole-screen loading). */
  fullScreen?: boolean;
  testID?: string;
}

/** Spinner with a visible label, announced politely to screen readers. */
export function LoadingIndicator({ label, fullScreen = false, testID }: LoadingIndicatorProps) {
  const { t } = useTranslation();
  const text = label ?? t('common.loading');

  return (
    <View
      style={[styles.container, fullScreen && styles.fullScreen]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={text}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <AppText variant="body" color="textSecondary" align="center">
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  fullScreen: { flex: 1, backgroundColor: colors.background },
});
