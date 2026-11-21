import { Pressable, StyleSheet } from 'react-native';
import { colors, radius, touchTarget } from '../../theme';
import { AppIcon, type IconName } from '../common/AppIcon';

interface IconButtonProps {
  icon: IconName;
  /** Required: an icon alone has no meaning for screen-reader users. */
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

/** 48dp icon-only button with a mandatory spoken label. */
export function IconButton({ icon, accessibilityLabel, onPress, testID }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <AppIcon name={icon} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: touchTarget.min,
    minHeight: touchTarget.min,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySurface,
  },
  pressed: { backgroundColor: colors.border },
});
