import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../localization';
import { colors, radius, shadows, spacing, touchTarget } from '../../theme';
import { AppIcon, type IconName } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import { StatusBadge } from '../feedback/StatusBadge';

interface ActionCardProps {
  title: string;
  description: string;
  icon: IconName;
  /** Omit to show the card as not yet available (decision D) - it is then disabled. */
  onPress?: () => void;
  /** Badge shown when `onPress` is missing. Defaults to "Coming soon". */
  unavailableLabel?: string;
  testID?: string;
}

/** Large tappable card for a main task. A missing `onPress` renders it disabled and labelled. */
export function ActionCard({ title, description, icon, onPress, unavailableLabel, testID }: ActionCardProps) {
  const { t } = useTranslation();
  const available = Boolean(onPress);
  const status = unavailableLabel ?? t('common.comingSoon');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={available ? title : t('action.a11y.unavailable', { title, status })}
      accessibilityHint={description}
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, !available && styles.unavailable]}
    >
      <View style={[styles.iconCircle, !available && styles.iconCircleMuted]}>
        <AppIcon name={icon} size="lg" color={available ? colors.textOnPrimary : colors.textSecondary} />
      </View>
      <View style={styles.text}>
        <AppText variant="subtitle" color={available ? 'textPrimary' : 'textSecondary'}>
          {title}
        </AppText>
        <AppText variant="bodySmall" color="textSecondary">
          {description}
        </AppText>
        {!available ? <StatusBadge label={status} tone="neutral" icon="lock-clock" /> : null}
      </View>
      {available ? <AppIcon name="chevron-right" color={colors.textSecondary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.primary + spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  pressed: { backgroundColor: colors.primarySurface },
  unavailable: { backgroundColor: colors.surfaceMuted },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleMuted: { backgroundColor: colors.border },
  text: { flex: 1, gap: spacing.xxs },
});
