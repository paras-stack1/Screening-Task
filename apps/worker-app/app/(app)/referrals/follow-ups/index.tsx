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
  ScreenContainer,
  StatusBadge,
} from '../../../../src/components';
import { formatIndiaDate } from '../../../../src/features/children/labels';
import type { FollowUpFilter } from '../../../../src/features/referrals/api';
import { useFollowUpList, useReferralPermissions } from '../../../../src/features/referrals/hooks';
import { followUpStatusKey } from '../../../../src/features/referrals/labels';
import { referralRoutes } from '../../../../src/features/referrals/routes';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { colors, spacing } from '../../../../src/theme';

/**
 * Follow-up tasks (Step 7F; decision Q). Field workers start with their own tasks; supervisors and
 * medical officers can see all tasks in their areas. "Overdue" is decided by the API from the due
 * date; "missed" is a person's decision with a reason.
 */
export default function FollowUpsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useReferralPermissions();
  const [filter, setFilter] = useState<FollowUpFilter>(permissions.canUpdate ? 'all' : 'mine');
  const list = useFollowUpList(filter, null, permissions.canRead);

  if (!permissions.loaded) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="follow-ups-screen">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (!permissions.canRead) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="follow-ups-screen">
        <EmptyState icon="lock-outline" title={t('referrals.notForRole')} />
      </ScreenContainer>
    );
  }
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <ScreenContainer edges={['left', 'right']} testID="follow-ups-screen">
      <ChoiceGroup<FollowUpFilter>
        label={t('referrals.filter')}
        options={[
          { value: 'mine', label: t('followUps.filter.mine') },
          { value: 'overdue', label: t('followUps.filter.overdue') },
          { value: 'all', label: t('followUps.filter.all') },
        ]}
        value={filter}
        onChange={setFilter}
        testID="follow-ups-filter"
      />
      {list.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : list.isError ? (
        <ErrorState message={t(apiErrorMessageKey(list.error))} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <AppText color="textSecondary" testID="follow-ups-empty">
          {t('followUps.none')}
        </AppText>
      ) : (
        <View style={styles.list}>
          {items.map((f) => (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              accessibilityLabel={f.childName}
              onPress={() => router.push(referralRoutes.followUp(f.id))}
              testID={`follow-up-item-${f.id}`}
            >
              <AppCard style={styles.row}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{f.childName}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {t(`followUps.reason.${f.reasonCode}` as TranslationKey)}
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    {t('followUps.dueLine', {
                      date: formatIndiaDate(`${f.dueDate}T00:00:00+05:30`),
                      status: t(followUpStatusKey(f.status)),
                    })}
                  </AppText>
                  {f.overdue ? <StatusBadge label={t('followUps.overdue')} tone="danger" /> : null}
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
              testID="follow-ups-more"
            />
          ) : null}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, gap: spacing.xxs },
});
