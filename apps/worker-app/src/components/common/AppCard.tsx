import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing } from '../../theme';

export interface AppCardProps extends Omit<ViewProps, 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Coloured left edge, e.g. for disclaimers or 4-D categories. */
  accentColor?: string;
}

/** White card with a subtle border and shadow - the basic building block of every screen. */
export function AppCard({ children, style, accentColor, ...rest }: AppCardProps) {
  return (
    <View
      style={[styles.card, accentColor ? { borderLeftWidth: 4, borderLeftColor: accentColor } : null, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.card,
  },
});
