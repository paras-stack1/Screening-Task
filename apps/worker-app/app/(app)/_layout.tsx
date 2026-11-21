import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation, type TranslationKey } from '../../src/localization';
import { colors, MAX_FONT_SCALE } from '../../src/theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const TABS: { name: string; title: TranslationKey; icon: IconName }[] = [
  { name: 'index', title: 'nav.dashboard', icon: 'home-outline' },
  { name: 'notifications', title: 'nav.notifications', icon: 'bell-outline' },
  { name: 'profile', title: 'nav.profile', icon: 'account-circle-outline' },
  { name: 'settings', title: 'nav.settings', icon: 'cog-outline' },
];

/**
 * Signed-in area: four bottom tabs, kept deliberately few. Only reachable with an authenticated
 * session that does not need a password change (see app/_layout.tsx).
 */
export default function AppTabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerTitleAllowFontScaling: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        tabBarAllowFontScaling: true,
        tabBarLabelPosition: 'below-icon',
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.title),
            tabBarAccessibilityLabel: t(tab.title),
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons
                name={tab.icon}
                // React Navigation passes theme colours, which are always strings here.
                color={typeof color === 'string' ? color : colors.textSecondary}
                size={size}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
