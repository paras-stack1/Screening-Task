import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';
import { AppIcon, type IconName } from '../common/AppIcon';
import { AppText } from '../common/AppText';

export type InlineAlertTone = 'info' | 'warning' | 'danger';

const tones: Record<InlineAlertTone, { text: string; surface: string; icon: IconName }> = {
  info: { text: colors.info, surface: colors.infoSurface, icon: 'information-outline' },
  warning: { text: colors.warning, surface: colors.warningSurface, icon: 'alert-circle-outline' },
  danger: { text: colors.danger, surface: colors.dangerSurface, icon: 'alert-circle-outline' },
};

interface InlineAlertProps {
  /** Translated, user-safe text. */
  message: string;
  tone?: InlineAlertTone;
  testID?: string;
}

/** Form-level message (e.g. sign-in failed). Announced to screen readers when it appears. */
export function InlineAlert({ message, tone = 'danger', testID }: InlineAlertProps) {
  const style = tones[tone];
  return (
    <View
      style={[styles.box, { backgroundColor: style.surface, borderLeftColor: style.text }]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      accessibilityLabel={message}
      testID={testID}
    >
      <AppIcon name={style.icon} color={style.text} />
      <AppText variant="bodySmall" style={[styles.text, { color: style.text }]}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 4,
  },
  text: { flex: 1, fontWeight: '600' },
});
