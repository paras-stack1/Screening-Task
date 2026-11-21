import { StyleSheet, Text, type TextProps } from 'react-native';
import { colors, MAX_FONT_SCALE, typography, type ColorToken, type TypographyVariant } from '../../theme';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: ColorToken;
  align?: 'left' | 'center' | 'right';
}

/**
 * The only text primitive. Applies the type scale and colour tokens, keeps system font scaling
 * on (capped at MAX_FONT_SCALE) and never truncates unless `numberOfLines` is passed explicitly.
 */
export function AppText({ variant = 'body', color = 'textPrimary', align, style, ...rest }: AppTextProps) {
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[typography[variant], { color: colors[color] }, align && styles[align], style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  left: { textAlign: 'left' },
  center: { textAlign: 'center' },
  right: { textAlign: 'right' },
});
