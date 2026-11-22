import { Stack } from 'expo-router';
import { useTranslation } from '../../../src/localization';
import { colors } from '../../../src/theme';

/**
 * Children section: list -> profile -> edit / guardians. URLs carry only opaque ids (never names
 * or phone numbers). Every screen re-reads its data from the API, which authorises each request.
 */
export default function ChildrenLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('children.list.title') }} />
      <Stack.Screen name="register" options={{ title: t('children.register.title') }} />
      <Stack.Screen name="[childId]/index" options={{ title: t('children.profile.title') }} />
      <Stack.Screen name="[childId]/edit" options={{ title: t('children.edit.title') }} />
      <Stack.Screen name="[childId]/add-guardian" options={{ title: t('children.addGuardian.title') }} />
      <Stack.Screen name="[childId]/link/[relationshipId]" options={{ title: t('children.link.title') }} />
      <Stack.Screen name="guardian/[guardianId]" options={{ title: t('children.guardian.title') }} />
    </Stack>
  );
}
