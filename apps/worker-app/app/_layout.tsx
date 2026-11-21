import { QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoadingIndicator } from '../src/components';
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { ConfigErrorScreen, SessionRestoreErrorScreen } from '../src/features/auth/components/StartupScreens';
import { LanguageProvider, useTranslation } from '../src/localization';
import { AppServicesProvider, getAppServices, useAppServices } from '../src/services/appServices';
import { ConnectivityProvider } from '../src/services/network/ConnectivityProvider';
import { colors } from '../src/theme';

// Keep the native splash screen up until the saved session has been checked.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Root navigator (docs/frontend/navigation.md). Route groups are switched by session state with
 * Stack.Protected, so a protected screen is never mounted - not even briefly - without a session.
 * This is a UX boundary only: the API authorises every request on its own.
 */
function RootNavigator() {
  const { state } = useAuth();
  const { isReady, t } = useTranslation();
  const { config } = useAppServices();
  const booting = state.status === 'initializing' || !isReady;

  useEffect(() => {
    if (!booting) SplashScreen.hideAsync().catch(() => undefined);
  }, [booting]);

  if (!config.api.ok) return <ConfigErrorScreen />;
  if (booting) return <LoadingIndicator fullScreen label={t('auth.restoring')} testID="session-restoring" />;
  if (state.status === 'restoreFailed') return <SessionRestoreErrorScreen />;

  const signedIn = state.status === 'authenticated';
  const mustChangePassword = signedIn && state.user.mustChangePassword;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={mustChangePassword}>
        <Stack.Screen name="change-password" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !mustChangePassword}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  const [services] = useState(getAppServices);
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <AppServicesProvider services={services}>
          <QueryClientProvider client={services.queryClient}>
            <ConnectivityProvider>
              <AuthProvider session={services.session}>
                <StatusBar style="dark" />
                <RootNavigator />
              </AuthProvider>
            </ConnectivityProvider>
          </QueryClientProvider>
        </AppServicesProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
