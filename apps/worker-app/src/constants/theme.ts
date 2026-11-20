/**
 * Design tokens for BalSwasthya AI.
 * Friendly healthcare look, high contrast, large touch targets for field workers.
 */
export const colors = {
  primary: '#1769AA',
  primaryDark: '#0F4C7D',
  secondary: '#16A6A0',
  background: '#F3F7FA',
  card: '#FFFFFF',
  textPrimary: '#14212B',
  textSecondary: '#4A5A68',
  border: '#D6E1EA',
  success: '#1E8E3E',
  warning: '#B36B00',
  danger: '#C62828',
  onPrimary: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/** Body text is larger than typical apps: readability for all literacy levels. */
export const typography = {
  title: 26,
  subtitle: 20,
  body: 17,
  caption: 14,
} as const;

/** Accessibility guidance: interactive targets at least 48dp. Primary actions use 56. */
export const touchTarget = {
  min: 48,
  primary: 56,
} as const;
