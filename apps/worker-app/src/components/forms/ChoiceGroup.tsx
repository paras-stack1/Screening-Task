import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, touchTarget } from '../../theme';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
}

interface ChoiceGroupProps<V extends string> {
  label: string;
  options: readonly ChoiceOption<V>[];
  /** '' = nothing chosen. Nothing is ever preselected unless the caller passes a value. */
  value: V | '';
  onChange: (value: V) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * Single choice shown as large wrapping buttons (radio semantics). Used instead of dropdowns so
 * every option is visible, easy to tap and announced by screen readers with its state.
 */
export function ChoiceGroup<V extends string>({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  disabled = false,
  testID,
}: ChoiceGroupProps<V>) {
  return (
    <View style={styles.container} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
      <AppText variant="label">{label}</AppText>
      {hint ? (
        <AppText variant="caption" color="textSecondary">
          {hint}
        </AppText>
      ) : null}
      <View style={styles.options}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              testID={testID ? `${testID}-${option.value}` : undefined}
              style={({ pressed }) => [
                styles.option,
                selected && styles.selected,
                error && !selected && styles.errorBorder,
                pressed && styles.pressed,
                disabled && styles.disabled,
              ]}
            >
              <AppIcon
                name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                size="sm"
                color={selected ? colors.primary : colors.textSecondary}
              />
              <AppText
                variant="bodySmall"
                style={styles.optionText}
                color={selected ? 'primary' : 'textPrimary'}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <AppText
          variant="bodySmall"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.min,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    maxWidth: '100%',
  },
  selected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySurface },
  errorBorder: { borderColor: colors.danger },
  pressed: { backgroundColor: colors.surfaceMuted },
  disabled: { opacity: 0.55 },
  optionText: { flexShrink: 1, fontWeight: '600' },
});
