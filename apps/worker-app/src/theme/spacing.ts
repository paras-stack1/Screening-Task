/** 4-point spacing scale. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Minimum touch target sizes (dp). Everything tappable is at least `min`. */
export const touchTarget = {
  min: 48,
  primary: 56,
} as const;

export const layout = {
  /** Horizontal padding of every screen. */
  screenPadding: spacing.md,
  /** Content width cap so tablets do not stretch forms edge to edge. */
  maxContentWidth: 560,
  iconSize: { sm: 20, md: 24, lg: 32 },
} as const;

export const zIndex = {
  banner: 10,
  toast: 20,
  dialog: 30,
} as const;
