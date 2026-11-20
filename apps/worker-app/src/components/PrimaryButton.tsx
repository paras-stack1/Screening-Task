import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing, touchTarget, typography } from '../constants/theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Spoken by screen readers when the label alone is not descriptive enough. */
  accessibilityHint?: string;
}

/** Large, high-contrast button sized for field use (56dp tall). */
export function PrimaryButton({ label, onPress, disabled = false, accessibilityHint }: PrimaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget.primary,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.primaryDark,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: colors.onPrimary,
    fontSize: typography.body,
    fontWeight: '600',
  },
});
