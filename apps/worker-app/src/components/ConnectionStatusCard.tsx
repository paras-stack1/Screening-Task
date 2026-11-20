import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../constants/theme';
import type { ApiHealthState } from '../hooks/useApiHealth';
import { useTranslation } from '../hooks/useTranslation';
import { AppCard } from './AppCard';
import { PrimaryButton } from './PrimaryButton';

interface ConnectionStatusCardProps {
  state: ApiHealthState;
  onRetry: () => void;
}

/** Shows whether the app can reach the backend API. Development aid for Step 1. */
export function ConnectionStatusCard({ state, onRetry }: ConnectionStatusCardProps) {
  const { t } = useTranslation();

  const dotColor =
    state.status === 'online' ? colors.success : state.status === 'offline' ? colors.danger : colors.warning;
  const label =
    state.status === 'online'
      ? t('connectionOnline')
      : state.status === 'offline'
        ? t('connectionOffline')
        : t('connectionChecking');

  return (
    <AppCard>
      <Text style={styles.title}>{t('connectionTitle')}</Text>
      <View style={styles.row} accessibilityLiveRegion="polite">
        {state.status === 'checking' ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        )}
        <Text style={styles.status}>{label}</Text>
      </View>
      {state.status === 'online' && (
        <Text style={styles.detail}>
          {state.data.service} v{state.data.version}
        </Text>
      )}
      {state.status === 'offline' && (
        <>
          <Text style={styles.detail}>{state.error}</Text>
          <PrimaryButton label={t('retry')} onPress={onRetry} />
        </>
      )}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  status: {
    fontSize: typography.body,
    color: colors.textPrimary,
  },
  detail: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
});
