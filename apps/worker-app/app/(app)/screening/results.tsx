import { RESULT_OUTCOMES, type ResultOutcome } from '@balswasthya/shared-contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppIcon,
  AppText,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  MetricCard,
  ScreenContainer,
  StatusBadge,
  type MetricState,
} from '../../../src/components';
import { formatIndiaDate } from '../../../src/features/children/labels';
import { OUTCOME_TONE, outcomeKey } from '../../../src/features/results/components/ResultView';
import { useResultDashboard, useResultList } from '../../../src/features/results/hooks';
import { resultRoutes } from '../../../src/features/results/routes';
import { useScreeningPermissions } from '../../../src/features/screening/hooks';
import { useTranslation } from '../../../src/localization';
import { apiErrorMessageKey } from '../../../src/services/api/errorMessages';
import { colors, spacing } from '../../../src/theme';

type Filter = ResultOutcome | 'ALL';

/**
 * Screening results in the user's areas (Step 7): real counts from the API (never invented) and
 * the current result of each screening, newest first, with an outcome filter.
 */
export default function ResultsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useScreeningPermissions();
  const [filter, setFilter] = useState<Filter>('ALL');
  const dashboard = useResultDashboard(permissions.canRead);
  const list = useResultList(filter === 'ALL' ? null : filter, permissions.canRead);

  if (!permissions.loaded) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="results-screen">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (!permissions.canRead) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="results-screen">
        <EmptyState icon="lock-outline" title={t('screening.home.notForRole')} />
      </ScreenContainer>
    );
  }
  const d = dashboard.data?.dashboard;
  const metric = (value: number | undefined): MetricState =>
    dashboard.isError
      ? { status: 'error' }
      : value === undefined
        ? { status: 'loading' }
        : { status: 'ready', value };
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ScreenContainer edges={['left', 'right']} testID="results-screen">
      <InlineAlert tone="info" message={t('results.notDiagnosis')} />
      {d?.includesUnapprovedContent ? <InlineAlert tone="warning" message={t('results.unapproved')} /> : null}
      <View style={styles.metrics}>
        <MetricCard
          label={t('results.metric.completed')}
          icon="clipboard-check-outline"
          state={metric(d?.completedScreenings)}
          testID="results-metric-completed"
        />
        <MetricCard
          label={t('results.metric.awaitingReview')}
          icon="account-clock-outline"
          state={metric(d?.awaitingReview)}
          testID="results-metric-review"
        />
        <MetricCard
          label={t('results.metric.further')}
          icon="alert-circle-outline"
          state={metric(d?.furtherEvaluation)}
          testID="results-metric-further"
        />
        <MetricCard
          label={t('results.metric.urgent')}
          icon="alert-octagon-outline"
          state={metric(d?.urgentEvaluation)}
          testID="results-metric-urgent"
        />
        <MetricCard
          label={t('results.metric.incomplete')}
          icon="progress-question"
          state={metric(d?.incompleteOrUndetermined)}
          testID="results-metric-incomplete"
        />
        <MetricCard
          label={t('results.metric.notInterpreted')}
          icon="file-question-outline"
          state={metric(d?.notInterpreted)}
          testID="results-metric-not-interpreted"
        />
      </View>

      <ChoiceGroup<Filter>
        label={t('results.filter')}
        options={[
          { value: 'ALL', label: t('results.filterAll') },
          ...RESULT_OUTCOMES.map((o) => ({ value: o, label: t(outcomeKey(o)) })),
        ]}
        value={filter}
        onChange={setFilter}
        testID="results-filter"
      />

      {list.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : list.isError ? (
        <ErrorState message={t(apiErrorMessageKey(list.error))} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <AppText color="textSecondary" testID="results-empty">
          {t('results.listEmpty')}
        </AppText>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.childName}
              onPress={() => router.push(resultRoutes.sessionResult(item.sessionId))}
              testID={`results-item-${item.id}`}
            >
              <AppCard style={styles.row}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{item.childName}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {t('results.listLine', {
                      date: formatIndiaDate(item.generatedAt),
                      version: item.screeningVersion,
                    })}
                  </AppText>
                  <StatusBadge
                    label={t(outcomeKey(item.overallOutcome))}
                    tone={OUTCOME_TONE[item.overallOutcome]}
                  />
                </View>
                <AppIcon name="chevron-right" color={colors.textSecondary} />
              </AppCard>
            </Pressable>
          ))}
          {list.hasNextPage ? (
            <AppButton
              variant="secondary"
              label={t('screening.reviewQueue.loadMore')}
              loading={list.isFetchingNextPage}
              onPress={() => void list.fetchNextPage()}
              testID="results-more"
            />
          ) : null}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, gap: spacing.xxs },
});
