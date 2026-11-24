import { REFERRAL_STATUSES, type ReferralStatus } from '@balswasthya/shared-contracts';
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
  LoadingIndicator,
  MetricCard,
  ScreenContainer,
  StatusBadge,
  type MetricState,
} from '../../../src/components';
import { formatIndiaDate } from '../../../src/features/children/labels';
import {
  useReferralDashboard,
  useReferralList,
  useReferralPermissions,
} from '../../../src/features/referrals/hooks';
import { referralStatusKey } from '../../../src/features/referrals/labels';
import { referralRoutes } from '../../../src/features/referrals/routes';
import { categoryTitleKey } from '../../../src/features/screening/labels';
import { useTranslation, type TranslationKey } from '../../../src/localization';
import { apiErrorMessageKey } from '../../../src/services/api/errorMessages';
import { colors, spacing } from '../../../src/theme';

type Filter = ReferralStatus | 'ALL' | 'AWAITING_MY_APPROVAL';

/**
 * Referral dashboard and list (Step 7F). All counts come from GET /dashboards/referrals over the
 * user's own areas - issued, acknowledged, visited and closed are separate numbers, never added.
 */
export default function ReferralsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useReferralPermissions();
  const [filter, setFilter] = useState<Filter>(permissions.canApprove ? 'AWAITING_MY_APPROVAL' : 'ALL');
  const dashboard = useReferralDashboard(permissions.canRead);
  const list = useReferralList(
    filter === 'ALL' || filter === 'AWAITING_MY_APPROVAL' ? null : filter,
    filter === 'AWAITING_MY_APPROVAL',
    permissions.canRead,
  );

  if (!permissions.loaded) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="referrals-screen">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (!permissions.canRead) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="referrals-screen">
        <EmptyState icon="lock-outline" title={t('referrals.notForRole')} />
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
  const filters: Filter[] = [
    ...(permissions.canApprove ? (['AWAITING_MY_APPROVAL'] as const) : []),
    'ALL',
    ...REFERRAL_STATUSES,
  ];

  return (
    <ScreenContainer edges={['left', 'right']} testID="referrals-screen">
      <View style={styles.metrics}>
        <MetricCard
          label={t('referrals.metric.total')}
          icon="hospital-building"
          state={metric(d?.referrals.total)}
          testID="referrals-metric-total"
        />
        <MetricCard
          label={t('referrals.metric.pendingApproval')}
          icon="account-clock-outline"
          state={metric(d?.referrals.pendingApproval)}
          testID="referrals-metric-pending"
        />
        <MetricCard
          label={t('referrals.metric.issued')}
          icon="send-outline"
          state={metric(d?.referrals.issued)}
          testID="referrals-metric-issued"
        />
        <MetricCard
          label={t('referrals.metric.visited')}
          icon="hospital-marker"
          state={metric(d?.referrals.visitRecorded)}
          testID="referrals-metric-visited"
        />
        <MetricCard
          label={t('referrals.metric.followUpsOpen')}
          icon="calendar-check-outline"
          state={metric(d?.followUps.open)}
          testID="referrals-metric-followups"
        />
        <MetricCard
          label={t('referrals.metric.followUpsOverdue')}
          icon="calendar-alert"
          state={metric(d?.followUps.overdue)}
          testID="referrals-metric-overdue"
        />
      </View>
      {permissions.canWorkFollowUps ? (
        <AppButton
          variant="secondary"
          icon="calendar-check-outline"
          label={t('followUps.title')}
          onPress={() => router.push(referralRoutes.followUps)}
          testID="referrals-follow-ups"
        />
      ) : null}
      <ChoiceGroup<Filter>
        label={t('referrals.filter')}
        options={filters.map((f) => ({
          value: f,
          label:
            f === 'ALL'
              ? t('results.filterAll')
              : f === 'AWAITING_MY_APPROVAL'
                ? t('referrals.awaitingMyApproval')
                : t(referralStatusKey(f)),
        }))}
        value={filter}
        onChange={setFilter}
        testID="referrals-filter"
      />
      {list.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : list.isError ? (
        <ErrorState message={t(apiErrorMessageKey(list.error))} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <AppText color="textSecondary" testID="referrals-empty">
          {t('referrals.empty')}
        </AppText>
      ) : (
        <View style={styles.list}>
          {items.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={r.childName}
              onPress={() => router.push(referralRoutes.referral(r.id))}
              testID={`referral-item-${r.id}`}
            >
              <AppCard style={styles.row}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{r.childName}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {[
                      r.category ? t(categoryTitleKey(r.category)) : null,
                      t(`results.priority.${r.priority}` as TranslationKey),
                      formatIndiaDate(r.updatedAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                  <StatusBadge
                    label={t(referralStatusKey(r.status))}
                    tone={r.pendingReassessments > 0 ? 'warning' : 'neutral'}
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
              testID="referrals-more"
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
