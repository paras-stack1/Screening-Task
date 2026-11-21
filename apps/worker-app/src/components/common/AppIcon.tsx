import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { colors, layout } from '../../theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface AppIconProps {
  name: IconName;
  size?: keyof typeof layout.iconSize;
  color?: string;
}

/**
 * Decorative icon from one icon family (only that font is bundled). Hidden from screen readers:
 * the meaning must always be carried by nearby text, never by the icon alone.
 */
export function AppIcon({ name, size = 'md', color = colors.textPrimary }: AppIconProps) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={layout.iconSize[size]}
      color={color}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}
