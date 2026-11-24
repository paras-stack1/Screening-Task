import { Stack } from 'expo-router';
import { useTranslation } from '../../../src/localization';
import { colors } from '../../../src/theme';

/**
 * Referrals and follow-ups (Step 7F). Reached from the dashboard, screening results and
 * notifications - not a tab. URLs carry only opaque ids; every screen re-reads from the API.
 */
export default function ReferralsLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('referrals.title') }} />
      <Stack.Screen name="new" options={{ title: t('referrals.new.title') }} />
      <Stack.Screen name="[referralId]" options={{ title: t('referrals.detail.title') }} />
      <Stack.Screen name="follow-ups/index" options={{ title: t('followUps.title') }} />
      <Stack.Screen name="follow-ups/[followUpId]" options={{ title: t('followUps.detail.title') }} />
    </Stack>
  );
}
