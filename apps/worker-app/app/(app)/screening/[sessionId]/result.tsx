import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppText,
  EmptyState,
  ErrorState,
  LoadingIndicator,
  ScreenContainer,
  SectionHeader,
  StatusBadge,
} from '../../../../src/components';
import { formatIndiaDateTime } from '../../../../src/features/children/labels';
import { OUTCOME_TONE, outcomeKey, ResultView } from '../../../../src/features/results/components/ResultView';
import { useReferralPermissions } from '../../../../src/features/referrals/hooks';
import { referralRoutes } from '../../../../src/features/referrals/routes';
import { useSessionResults } from '../../../../src/features/results/hooks';
import { categoryTitleKey } from '../../../../src/features/screening/labels';
import { screeningRoutes } from '../../../../src/features/screening/routes';
import { useTranslation } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { spacing } from '../../../../src/theme';

/**
 * Result of one completed screening (Step 7): the automated interpretation of the CURRENT version,
 * its review status, and the earlier versions (after amendments). The recorded answers stay on the
 * summary screen - the two are kept apart on purpose.
 */
export default function SessionResultScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
  const results = useSessionResults(sessionId);
  const referrals = useReferralPermissions();

  if (results.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="session-result">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (results.isError) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="session-result">
        <ErrorState message={t(apiErrorMessageKey(results.error))} onRetry={() => void results.refetch()} />
      </ScreenContainer>
    );
  }
  const { current, history } = results.data;
  return (
    <ScreenContainer edges={['left', 'right']} testID="session-result">
      {current ? (
        <ResultView run={current} />
      ) : (
        <EmptyState
          icon="file-question-outline"
          title={t('results.none.title')}
          message={t('results.none.message')}
        />
      )}
      {current && current.isCurrent && referrals.canCreate ? (
        <View style={styles.list} testID="result-referral-actions">
          {current.categories
            .filter((c) => c.referralRecommended)
            .map((c) => (
              <AppButton
                key={c.category}
                icon="hospital-building"
                label={t('referrals.fromResult', { category: t(categoryTitleKey(c.category)) })}
                onPress={() =>
                  router.push(
                    referralRoutes.create(current.childId, {
                      sessionId,
                      category: c.category,
                      recommended: true,
                    }),
                  )
                }
                testID={`result-refer-${c.category}`}
              />
            ))}
          <AppButton
            variant="secondary"
            icon="hospital-building"
            label={t('referrals.otherConcern')}
            onPress={() => router.push(referralRoutes.create(current.childId))}
            testID="result-refer-other"
          />
        </View>
      ) : null}
      <AppButton
        variant="secondary"
        icon="clipboard-text-outline"
        label={t('results.viewAnswers')}
        onPress={() => router.push(screeningRoutes.summary(sessionId))}
        testID="result-view-answers"
      />
      {history.length > 1 ? (
        <View style={styles.list} testID="result-history">
          <SectionHeader title={t('results.history')} />
          {history.map((h) => (
            <AppCard key={h.id} style={styles.row}>
              <AppText variant="bodySmall" style={styles.flex}>
                {t('results.historyLine', {
                  version: h.screeningVersion,
                  date: formatIndiaDateTime(h.generatedAt),
                })}
                {h.isCurrent ? ` · ${t('results.current')}` : ''}
              </AppText>
              <StatusBadge label={t(outcomeKey(h.overallOutcome))} tone={OUTCOME_TONE[h.overallOutcome]} />
            </AppCard>
          ))}
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
});
