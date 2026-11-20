import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SupportedLanguage } from '@balswasthya/shared-contracts';
import { colors, radius, spacing, touchTarget, typography } from '../constants/theme';
import { useTranslation } from '../hooks/useTranslation';

const OPTIONS: { value: SupportedLanguage; label: string }[] = [
  { value: 'hi', label: 'हिंदी' },
  { value: 'en', label: 'English' },
];

/** Hindi / English switch. Each label is written in its own script so it is recognisable. */
export function LanguageToggle() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <View style={styles.container} accessibilityRole="radiogroup" accessibilityLabel={t('languageLabel')}>
      {OPTIONS.map((option) => {
        const selected = option.value === language;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => setLanguage(option.value)}
            style={[styles.option, selected && styles.optionSelected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    alignSelf: 'flex-end',
  },
  option: {
    minHeight: touchTarget.min,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: {
    backgroundColor: colors.secondary,
  },
  label: {
    fontSize: typography.body,
    color: colors.textPrimary,
  },
  labelSelected: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
});
