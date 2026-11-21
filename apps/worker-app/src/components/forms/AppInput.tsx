import { useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, MAX_FONT_SCALE, radius, spacing, touchTarget, typography } from '../../theme';
import { AppText } from '../common/AppText';

export interface AppInputProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  /** Visible label - always shown, placeholders are not labels. */
  label: string;
  /** Validation message; also announced to screen readers. */
  error?: string;
  hint?: string;
  /** Control rendered inside the field on the right, e.g. show/hide password. */
  accessory?: ReactNode;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}

export function AppInput({
  label,
  error,
  hint,
  accessory,
  ref,
  onFocus,
  onBlur,
  editable = true,
  ...rest
}: AppInputProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.focus : colors.borderStrong;

  return (
    <View style={styles.container}>
      <AppText variant="label">{label}</AppText>
      <View
        style={[
          styles.field,
          { borderColor, borderWidth: focused || error ? 2 : 1.5 },
          !editable && styles.fieldDisabled,
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          accessibilityState={{ disabled: !editable }}
          editable={editable}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
        {accessory}
      </View>
      {hint && !error ? (
        <AppText variant="caption" color="textSecondary">
          {hint}
        </AppText>
      ) : null}
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
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.primary,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fieldDisabled: { backgroundColor: colors.surfaceMuted },
  input: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
