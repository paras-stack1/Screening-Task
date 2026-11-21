import type { ViewStyle } from 'react-native';

/**
 * Subtle elevation. Android uses `elevation`; iOS/web use the shadow* props. Kept light because
 * heavy shadows cost rendering time on low-end Android devices.
 */
export const shadows = {
  none: {},
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  raised: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
} as const satisfies Record<string, ViewStyle>;
