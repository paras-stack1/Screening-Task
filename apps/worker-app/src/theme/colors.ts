/**
 * Colour tokens. Components must use these names, never raw hex values.
 *
 * Contrast (WCAG 2.1 AA) is enforced by tests/theme/contrast.test.ts. Adjustments made to the
 * approved palette for contrast (decision H, docs/frontend/design-system.md):
 *  - textSecondary #64748B -> #5B6B80 (4.42:1 -> 5.05:1 on the app background).
 *  - The teal #16A6A0 is 3.0:1 against white: it is used for accents only. Text on teal, and teal
 *    text, use secondaryStrong #0E7C77 (5.04:1).
 *  - Input outlines use borderStrong (#64748B) so fields meet the 3:1 non-text contrast rule;
 *    #E2E8F0 is kept for decorative card borders and dividers only.
 */
export const palette = {
  blue700: '#0F4C7D',
  blue600: '#1769AA',
  blue50: '#E8F2FA',
  teal700: '#0E7C77',
  teal500: '#16A6A0',
  teal50: '#E6F6F5',
  slate800: '#1F2937',
  slate600: '#5B6B80',
  slate500: '#64748B',
  slate200: '#E2E8F0',
  slate100: '#F1F5F9',
  background: '#F3F7FA',
  white: '#FFFFFF',
  green700: '#15803D',
  green50: '#F0FDF4',
  amber700: '#B45309',
  amber50: '#FFFBEB',
  red800: '#991B1B',
  red700: '#B91C1C',
  red50: '#FEF2F2',
  indigo700: '#1D4ED8',
  indigo50: '#EFF6FF',
  violet700: '#6D28D9',
  violet50: '#F5F3FF',
} as const;

export const colors = {
  primary: palette.blue600,
  primaryPressed: palette.blue700,
  primarySurface: palette.blue50,
  /** Accent only (icons, borders, highlights). Not for text: 3.0:1 against white. */
  secondary: palette.teal500,
  /** Teal for text and for filled controls that carry text. */
  secondaryStrong: palette.teal700,
  secondarySurface: palette.teal50,

  background: palette.background,
  surface: palette.white,
  surfaceMuted: palette.slate100,

  textPrimary: palette.slate800,
  textSecondary: palette.slate600,
  textOnPrimary: palette.white,
  textDisabled: palette.slate500,

  border: palette.slate200,
  borderStrong: palette.slate500,
  focus: palette.blue600,

  success: palette.green700,
  successSurface: palette.green50,
  warning: palette.amber700,
  warningSurface: palette.amber50,
  danger: palette.red700,
  dangerPressed: palette.red800,
  dangerSurface: palette.red50,
  info: palette.blue600,
  infoSurface: palette.blue50,

  /** Dialog backdrop. */
  overlay: 'rgba(15, 23, 42, 0.5)',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * RBSK 4-D category identities. Colour is never the only signal: every use pairs it with an icon
 * and a text label.
 */
export const fourDColors = {
  defectsAtBirth: { accent: palette.indigo700, surface: palette.indigo50 },
  deficiencies: { accent: palette.amber700, surface: palette.amber50 },
  diseases: { accent: palette.red700, surface: palette.red50 },
  developmentalDelays: { accent: palette.violet700, surface: palette.violet50 },
} as const;

export type FourDCategory = keyof typeof fourDColors;
