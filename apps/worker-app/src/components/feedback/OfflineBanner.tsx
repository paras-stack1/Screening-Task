import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../localization';
import { colors, spacing } from '../../theme';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';

/** Full-width notice while the device is offline. Announced politely when it appears. */
export function OfflineBanner({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <View
      style={styles.banner}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('connectivity.offlineBanner')}
      testID="offline-banner"
    >
      <AppIcon name="wifi-off" size="sm" color={colors.warning} />
      <AppText variant="bodySmall" style={styles.text}>
        {t('connectivity.offlineBanner')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  text: { flex: 1, color: colors.warning, fontWeight: '600' },
});
