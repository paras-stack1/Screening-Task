import { Pressable, StyleSheet, View } from 'react-native';
import { LANGUAGE_OPTIONS, useTranslation } from '../../localization';
import { colors, radius, spacing, touchTarget } from '../../theme';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';

interface LanguageSelectorProps {
  /** `compact` for headers (login screen), `full` for the settings screen. */
  layout?: 'compact' | 'full';
}

/**
 * Hindi / English switch. Each option is written in its own script and announced as a radio
 * button, so it can be found whatever the current language. The choice is saved on the device.
 */
export function LanguageSelector({ layout = 'compact' }: LanguageSelectorProps) {
  const { language, setLanguage, t } = useTranslation();
  const full = layout === 'full';

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('language.label')}
      style={[styles.group, full ? styles.groupFull : styles.groupCompact]}
    >
      {!full ? <AppIcon name="translate" size="sm" color={colors.textSecondary} /> : null}
      {LANGUAGE_OPTIONS.map((option) => {
        const selected = option.value === language;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, selected }}
            accessibilityLabel={option.nativeName}
            onPress={() => {
              if (!selected) setLanguage(option.value);
            }}
            style={[styles.option, full && styles.optionFull, selected && styles.optionSelected]}
            testID={`language-option-${option.value}`}
          >
            <AppText
              variant={selected ? 'bodyStrong' : 'body'}
              style={{ color: selected ? colors.textOnPrimary : colors.textPrimary }}
            >
              {option.nativeName}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  groupCompact: { alignSelf: 'flex-end', paddingLeft: spacing.sm },
  groupFull: { alignSelf: 'stretch' },
  option: {
    minHeight: touchTarget.min,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionFull: { flex: 1 },
  // Teal fill with text uses the strong teal (white text on the light teal fails contrast).
  optionSelected: { backgroundColor: colors.secondaryStrong },
});
