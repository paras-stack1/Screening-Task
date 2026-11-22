import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppText,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  SectionHeader,
} from '../../components';
import { useTranslation } from '../../localization';
import { apiErrorMessageKey } from '../../services/api/errorMessages';
import { spacing } from '../../theme';
import { useChildConsents, useChildPermissions } from '../children/hooks';
import { childRoutes } from '../children/routes';
import { ConsentStatusBadge, purposeLabel, reasonLabel } from './ConsentStatusBadge';

/** Consent section of the child profile: the API's status for every purpose. */
export function ConsentOverview({ childId }: { childId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useChildPermissions();
  const consents = useChildConsents(childId);

  return (
    <View style={styles.stack} testID="consent-overview">
      <SectionHeader title={t('consent.overview.title')} subtitle={t('consent.overview.subtitle')} />
      {consents.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : consents.isError ? (
        <ErrorState message={t(apiErrorMessageKey(consents.error))} onRetry={() => void consents.refetch()} />
      ) : (
        <AppCard>
          {consents.data.statuses.some((s) => s.status === 'WITHDRAWN' || s.status === 'NOT_VALID') ? (
            <InlineAlert
              tone="warning"
              message={t('consent.overview.attention')}
              testID="consent-attention"
            />
          ) : null}
          {consents.data.statuses.map((status) => (
            <View
              key={status.purpose}
              style={styles.row}
              accessible
              testID={`consent-status-${status.purpose}`}
            >
              <AppText variant="bodyStrong" style={styles.purpose}>
                {purposeLabel(t, status.purpose)}
              </AppText>
              <ConsentStatusBadge status={status} />
              {status.reason ? (
                <AppText variant="caption" color="textSecondary">
                  {reasonLabel(t, status.reason)}
                </AppText>
              ) : null}
            </View>
          ))}
        </AppCard>
      )}
      {permissions.canRecordConsent ? (
        <AppButton
          icon="file-sign"
          label={t('consent.overview.record')}
          onPress={() => router.push(childRoutes.recordConsent(childId))}
          testID="consent-record"
        />
      ) : null}
      <AppButton
        variant="secondary"
        icon="history"
        label={t('consent.overview.history')}
        onPress={() => router.push(childRoutes.consentHistory(childId))}
        testID="consent-history"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: { gap: spacing.xxs, paddingVertical: spacing.xs },
  purpose: { flexShrink: 1 },
});
