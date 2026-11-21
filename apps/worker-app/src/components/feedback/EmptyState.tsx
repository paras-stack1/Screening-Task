import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '../../theme';
import { AppButton } from '../buttons/AppButton';
import { AppIcon, type IconName } from '../common/AppIcon';
import { AppText } from '../common/AppText';

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: IconName;
  /** Optional next step for the user. */
  action?: { label: string; onPress: () => void };
  testID?: string;
}

/** "Nothing here" explained in words, with an optional next action. */
export function EmptyState({ title, message, icon = 'inbox-outline', action, testID }: EmptyStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.iconCircle}>
        <AppIcon name={icon} size="lg" color={colors.primary} />
      </View>
      <AppText variant="subtitle" align="center" accessibilityRole="header">
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" color="textSecondary" align="center">
          {message}
        </AppText>
      ) : null}
      {action ? <AppButton variant="secondary" label={action.label} onPress={action.onPress} /> : null}
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
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
