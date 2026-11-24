import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SelectedChildProvider } from '../src/children';
import { Loading } from '../src/components/ui';
import { I18nProvider, useI18n } from '../src/i18n';
import { getAppServices, ServicesProvider } from '../src/services';
import { OnboardingProvider } from '../src/session/OnboardingProvider';
import { SessionProvider, useSession } from '../src/session/SessionProvider';
import { colors } from '../src/theme';

/**
 * Parent Portal navigator. Screens are switched by session state with Stack.Protected, so the
 * portal screens are never mounted without a session (a UX boundary - the API checks every call).
 * Before sign-in nothing about any child is shown.
 */
function RootNavigator() {
  const { state } = useSession();
  const { t } = useI18n();
  if (state.status === 'restoring') return <Loading label={t('common.loading')} testID="session-restoring" />;
  const signedIn = state.status === 'signedIn';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="invite" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="create-password" />
        <Stack.Screen name="activated" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(portal)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [services] = useState(getAppServices);
  return (
    <SafeAreaProvider>
      <ServicesProvider services={services}>
        <QueryClientProvider client={services.queryClient}>
          <I18nProvider>
            <SessionProvider>
              <OnboardingProvider>
                <SelectedChildProvider>
                  <StatusBar style="light" />
                  <RootNavigator />
                </SelectedChildProvider>
              </OnboardingProvider>
            </SessionProvider>
          </I18nProvider>
        </QueryClientProvider>
      </ServicesProvider>
    </SafeAreaProvider>
  );
}
