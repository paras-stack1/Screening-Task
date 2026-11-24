/** Parent Portal look (brief: blue #1769AA, teal #16A6A0). Large type and touch targets. */
export const colors = {
  primary: '#1769AA',
  primaryDark: '#0F4C7C',
  primarySurface: '#E8F2FA',
  teal: '#16A6A0',
  tealSurface: '#E3F6F5',
  background: '#F3F8FB',
  surface: '#FFFFFF',
  text: '#1F2937',
  textSecondary: '#4B5563',
  border: '#D1DCE5',
  danger: '#B42318',
  dangerSurface: '#FDECEA',
  warning: '#8A5A00',
  warningSurface: '#FFF4DC',
  success: '#126B3A',
  successSurface: '#E6F4EA',
  disabled: '#9CA3AF',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;
/** Minimum touch target (dp). */
export const touch = 52;
export const font = { small: 15, body: 17, large: 20, title: 24, hero: 28 } as const;
