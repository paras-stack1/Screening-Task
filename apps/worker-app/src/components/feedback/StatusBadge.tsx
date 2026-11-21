import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';
import { AppIcon, type IconName } from '../common/AppIcon';
import { AppText } from '../common/AppText';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const tones: Record<StatusTone, { text: string; surface: string; icon: IconName }> = {
  neutral: { text: colors.textSecondary, surface: colors.surfaceMuted, icon: 'information-outline' },
  info: { text: colors.info, surface: colors.infoSurface, icon: 'information-outline' },
  success: { text: colors.success, surface: colors.successSurface, icon: 'check-circle-outline' },
  warning: { text: colors.warning, surface: colors.warningSurface, icon: 'alert-circle-outline' },
  danger: { text: colors.danger, surface: colors.dangerSurface, icon: 'alert-circle-outline' },
};

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  /** Overrides the tone's default icon. */
  icon?: IconName;
}

/** Small status pill. Always icon + text, so status never depends on colour alone. */
export function StatusBadge({ label, tone = 'neutral', icon }: StatusBadgeProps) {
  const style = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: style.surface }]}>
      <AppIcon name={icon ?? style.icon} size="sm" color={style.text} />
      <AppText variant="caption" style={[styles.label, { color: style.text }]}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
  },
  label: { fontWeight: '600', flexShrink: 1 },
});
