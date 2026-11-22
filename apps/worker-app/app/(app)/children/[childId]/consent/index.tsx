import type { ConsentRecord } from '@balswasthya/shared-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppText,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  ScreenContainer,
  SectionHeader,
  StatusBadge,
} from '../../../../../src/components';
import { useChildConsents, useChildPermissions } from '../../../../../src/features/children/hooks';
import { formatIndiaDate } from '../../../../../src/features/children/labels';
import { childRoutes } from '../../../../../src/features/children/routes';
import {
  ConsentStatusBadge,
  decisionLabel,
  methodLabel,
  purposeLabel,
  reasonLabel,
} from '../../../../../src/features/consent/ConsentStatusBadge';
import { useTranslation } from '../../../../../src/localization';
import { apiErrorMessageKey } from '../../../../../src/services/api/errorMessages';
import { spacing } from '../../../../../src/theme';

/**
 * Consent status per purpose and the full, append-only history (newest first). Withdrawal is
 * offered only on the CURRENT grant of a purpose - the API decides, the screen only offers it.
 */
export default function ConsentHistoryScreen() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useChildPermissions();
  const consents = useChildConsents(childId ?? '');

  if (consents.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']}>
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (consents.isError) {
    return (
      <ScreenContainer edges={['left', 'right']}>
        <ErrorState message={t(apiErrorMessageKey(consents.error))} onRetry={() => void consents.refetch()} />
      </ScreenContainer>
    );
  }

  const { statuses, history } = consents.data;
  const isCurrentGrant = (record: ConsentRecord) =>
    record.decision === 'GRANTED' &&
    !record.withdrawnAt &&
    statuses.some((s) => s.purpose === record.purpose && s.consentId === record.id);

  return (
    <ScreenContainer edges={['left', 'right']} testID="consent-history-screen">
      <SectionHeader title={t('consent.history.statusTitle')} subtitle={t('consent.overview.subtitle')} />
      <AppCard>
        {statuses.map((status) => (
          <View key={status.purpose} style={styles.statusRow} accessible>
            <AppText variant="bodyStrong">{purposeLabel(t, status.purpose)}</AppText>
            <ConsentStatusBadge status={status} />
            {status.reason ? (
              <AppText variant="caption" color="textSecondary">
                {reasonLabel(t, status.reason)}
              </AppText>
            ) : null}
          </View>
        ))}
      </AppCard>

      <SectionHeader
        title={t('consent.history.timelineTitle')}
        subtitle={t('consent.history.timelineSubtitle')}
      />
      {history.length === 0 ? (
        <EmptyState
          icon="file-document-outline"
          title={t('consent.history.empty')}
          testID="consent-history-empty"
        />
      ) : (
        history.map((record) => (
          <AppCard key={record.id} testID={`consent-record-${record.id}`}>
            <AppText variant="subtitle">{purposeLabel(t, record.purpose)}</AppText>
            <StatusBadge
              label={decisionLabel(t, record.decision)}
              tone={record.decision === 'GRANTED' ? 'info' : 'neutral'}
              icon={record.decision === 'GRANTED' ? 'check' : 'close'}
            />
            <Line label={t('consent.history.guardian')} value={record.guardianName} />
            <Line label={t('consent.history.method')} value={methodLabel(t, record.method)} />
            <Line
              label={t('consent.history.notice')}
              value={t('consent.record.noticeVersion', {
                version: record.noticeVersion,
                language: record.noticeLanguage,
              })}
            />
            {record.noticeWasPlaceholder ? (
              <AppText variant="caption" color="warning">
                {t('consent.history.placeholderNotice')}
              </AppText>
            ) : null}
            {record.evidenceReference ? (
              <Line label={t('consent.record.evidence')} value={record.evidenceReference} />
            ) : null}
            <Line
              label={t('consent.history.recorded')}
              value={t('consent.history.recordedBy', {
                date: formatIndiaDate(record.recordedAt),
                name: record.recordedByName,
              })}
            />
            {record.withdrawnAt ? (
              <InlineAlert
                tone="warning"
                message={t('consent.history.withdrawnLine', {
                  date: formatIndiaDate(record.withdrawnAt),
                  name: record.withdrawnByName ?? '',
                  method: record.withdrawalMethod ? methodLabel(t, record.withdrawalMethod) : '',
                })}
                testID={`consent-withdrawn-${record.id}`}
              />
            ) : null}
            {permissions.canRecordConsent && isCurrentGrant(record) ? (
              <AppButton
                variant="danger"
                icon="undo-variant"
                label={t('consent.history.withdraw')}
                onPress={() => router.push(childRoutes.withdrawConsent(childId ?? '', record.id))}
                testID={`consent-withdraw-${record.id}`}
              />
            ) : null}
          </AppCard>
        ))
      )}
    </ScreenContainer>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      <AppText variant="bodySmall">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  statusRow: { gap: spacing.xxs, paddingVertical: spacing.xs },
  line: { gap: spacing.xxs },
});
