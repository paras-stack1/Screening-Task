import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../localization';
import { colors, spacing } from '../../theme';
import { AppCard } from '../common/AppCard';
import { AppIcon, type IconName } from '../common/AppIcon';
import { AppText } from '../common/AppText';

/**
 * `unavailable` means the backend has no source for this number yet. It is shown as "—" with
 * "Not available yet" and must never be presented as 0 (decision C).
 */
export type MetricState =
  | { status: 'loading' }
  | { status: 'ready'; value: number }
  | { status: 'unavailable' }
  | { status: 'error' };

interface MetricCardProps {
  label: string;
  icon: IconName;
  state: MetricState;
  /** Caption for the `unavailable` state. Defaults to "Not available yet". */
  unavailableLabel?: string;
  testID?: string;
}

export function MetricCard({ label, icon, state, unavailableLabel, testID }: MetricCardProps) {
  const { t, language } = useTranslation();

  let display = '—';
  let caption: string | undefined;
  let a11yLabel: string;
  switch (state.status) {
    case 'ready':
      display = new Intl.NumberFormat(`${language}-IN`).format(state.value);
      a11yLabel = t('metric.a11y.value', { label, value: display });
      break;
    case 'loading':
      a11yLabel = t('metric.a11y.loading', { label });
      break;
    case 'unavailable':
      caption = unavailableLabel ?? t('common.notAvailableYet');
      a11yLabel = unavailableLabel
        ? t('metric.a11y.value', { label, value: unavailableLabel })
        : t('metric.a11y.unavailable', { label });
      break;
    case 'error':
      caption = t('metric.couldNotLoad');
      a11yLabel = t('metric.a11y.error', { label });
      break;
  }

  return (
    <AppCard style={styles.card} accessible accessibilityLabel={a11yLabel} testID={testID}>
      <View style={styles.iconCircle}>
        <AppIcon name={icon} color={colors.primary} />
      </View>
      {state.status === 'loading' ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : (
        <AppText variant="metric" color={state.status === 'ready' ? 'textPrimary' : 'textSecondary'}>
          {display}
        </AppText>
      )}
      <AppText variant="bodySmall">{label}</AppText>
      {caption ? (
        <AppText variant="caption" color={state.status === 'error' ? 'danger' : 'textSecondary'}>
          {caption}
        </AppText>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 140, gap: spacing.xs },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: { alignSelf: 'flex-start', marginVertical: spacing.sm },
});
