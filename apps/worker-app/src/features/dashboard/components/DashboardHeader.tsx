import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText, IconButton, SyncStatusIndicator } from '../../../components';
import { useTranslation } from '../../../localization';
import { useConnectivityStatus } from '../../../services/network/ConnectivityProvider';
import { spacing } from '../../../theme';

/** Greeting with the signed-in worker's name (from the session, never hard-coded) and shortcuts. */
export function DashboardHeader({ displayName }: { displayName: string }) {
  const { t } = useTranslation();
  const connectivity = useConnectivityStatus();

  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <AppText variant="title" accessibilityRole="header">
          {t('dashboard.greeting', { name: displayName })}
        </AppText>
        <AppText color="textSecondary">{t('dashboard.subtitle')}</AppText>
        {connectivity !== 'unknown' ? <SyncStatusIndicator status={connectivity} /> : null}
      </View>
      <View style={styles.actions}>
        <IconButton
          icon="bell-outline"
          accessibilityLabel={t('dashboard.openNotifications')}
          onPress={() => router.navigate('/notifications')}
          testID="dashboard-open-notifications"
        />
        <IconButton
          icon="account-circle-outline"
          accessibilityLabel={t('dashboard.openProfile')}
          onPress={() => router.navigate('/profile')}
          testID="dashboard-open-profile"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  text: { flex: 1, gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
