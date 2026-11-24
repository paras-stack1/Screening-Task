import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useConnectivityStatus } from '../../services/network/ConnectivityProvider';
import { colors, layout, spacing } from '../../theme';
import { OfflineBanner } from '../feedback/OfflineBanner';

interface ScreenContainerProps {
  children: ReactNode;
  /** Scrollable by default so large text and long Hindi labels never get cut off. */
  scroll?: boolean;
  /** Keeps focused inputs above the on-screen keyboard (forms). */
  keyboardAware?: boolean;
  /** Safe-area edges to pad. Screens under a navigation header usually skip 'top'. */
  edges?: Edge[];
  /** Fixed content below the scroll area, e.g. a banner. */
  footer?: ReactNode;
  /** Wider content cap for screens with a side column on large screens (default: form width). */
  maxContentWidth?: number;
  testID?: string;
}

export function ScreenContainer({
  children,
  scroll = true,
  keyboardAware = false,
  edges = ['top', 'bottom', 'left', 'right'],
  footer,
  maxContentWidth,
  testID,
}: ScreenContainerProps) {
  // Every screen shows the offline banner at the top (below any navigation header).
  const offline = useConnectivityStatus() === 'offline';
  const width = maxContentWidth ? { maxWidth: maxContentWidth } : null;
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.inner, width]}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[styles.inner, width, styles.fill]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={edges} testID={testID}>
      <OfflineBanner visible={offline} />
      {keyboardAware ? (
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
      {footer}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    padding: layout.screenPadding,
    gap: spacing.md,
  },
});
