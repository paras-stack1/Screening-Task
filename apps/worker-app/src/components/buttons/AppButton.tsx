import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, touchTarget } from '../../theme';
import { AppIcon, type IconName } from '../common/AppIcon';
import { AppText } from '../common/AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface AppButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks presses - use while a request is in flight. */
  loading?: boolean;
  icon?: IconName;
  /** Spoken by screen readers when the label alone is not descriptive enough. */
  accessibilityHint?: string;
  testID?: string;
}

const variantStyles = {
  primary: {
    background: colors.primary,
    pressed: colors.primaryPressed,
    text: colors.textOnPrimary,
    border: colors.primary,
  },
  secondary: {
    background: colors.surface,
    pressed: colors.primarySurface,
    text: colors.primary,
    border: colors.primary,
  },
  ghost: {
    background: 'transparent',
    pressed: colors.surfaceMuted,
    text: colors.primary,
    border: 'transparent',
  },
  danger: {
    background: colors.danger,
    pressed: colors.dangerPressed,
    text: colors.textOnPrimary,
    border: colors.danger,
  },
} as const;

/**
 * Button sized for field use (56dp primary target). `loading` doubles as duplicate-submission
 * protection: the button cannot be pressed again until the caller clears it.
 */
export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  accessibilityHint,
  testID,
}: AppButtonProps) {
  const palette = variantStyles[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? palette.pressed : palette.background, borderColor: palette.border },
        inactive && styles.inactive,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            color={palette.text}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : icon ? (
          <AppIcon name={icon} color={palette.text} />
        ) : null}
        <AppText variant="bodyStrong" align="center" style={[styles.label, { color: palette.text }]}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

type VariantButtonProps = Omit<AppButtonProps, 'variant'>;

export function PrimaryButton(props: VariantButtonProps) {
  return <AppButton {...props} variant="primary" />;
}

export function SecondaryButton(props: VariantButtonProps) {
  return <AppButton {...props} variant="secondary" />;
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget.primary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  // Long Hindi labels wrap onto a second line instead of being cut off.
  label: { flexShrink: 1 },
  inactive: { opacity: 0.55 },
});
