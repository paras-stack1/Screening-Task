import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../src/constants/theme';
import { LanguageProvider } from '../src/i18n/LanguageProvider';

/** Root layout: global providers + navigation stack. Auth gating will be added in a later step. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: colors.onPrimary,
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'BalSwasthya AI' }} />
        </Stack>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
