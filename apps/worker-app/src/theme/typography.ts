import type { TextStyle } from 'react-native';

/**
 * Type scale. Uses the platform system font (decision E): Android ships Noto Sans and Noto Sans
 * Devanagari, so Hindi and English render without bundling fonts.
 *
 * Line heights are about 1.5x the font size on purpose: Devanagari vowel signs (matras) sit above
 * and below the line and are clipped by tight line heights. Do not set `includeFontPadding: false`
 * on Android for the same reason.
 */
export const typography = {
  display: { fontSize: 28, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 33, fontWeight: '700' },
  subtitle: { fontSize: 19, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 26, fontWeight: '400' },
  bodyStrong: { fontSize: 17, lineHeight: 26, fontWeight: '600' },
  label: { fontSize: 15, lineHeight: 23, fontWeight: '600' },
  bodySmall: { fontSize: 15, lineHeight: 23, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 20, fontWeight: '400' },
  metric: { fontSize: 30, lineHeight: 40, fontWeight: '700' },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/**
 * Upper bound for the user's system font scaling. Text still grows (accessibility), but layouts
 * stay usable on small screens. Large text up to 1.8x remains readable everywhere in the app.
 */
export const MAX_FONT_SCALE = 1.8;
