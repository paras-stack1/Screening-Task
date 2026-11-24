import { Stack } from 'expo-router';
import { colors } from '../../src/theme';

/** Signed-in Parent Portal. Mounted only with a session (root layout guard). */
export default function PortalLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
  );
}
