import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppIcon,
  AppText,
  EmptyState,
  ErrorState,
  LoadingIndicator,
  ScreenContainer,
  StatusBadge,
} from '../../../../src/components';
import { formatIndiaDate } from '../../../../src/features/children/labels';
import { OUTCOME_TONE, outcomeKey } from '../../../../src/features/results/components/ResultView';
import { useReviewQueue } from '../../../../src/features/results/hooks';
import { resultRoutes } from '../../../../src/features/results/routes';
import { useScreeningPermissions } from '../../../../src/features/screening/hooks';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { colors, spacing } from '../../../../src/theme';

/**
 * Medical officer (screening.review): open clinical reviews of current screening results in the
 * officer's areas, oldest first (decision G). The API decides the list.
 */
export default function ReviewQueueScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useScreeningPermissions();
  const queue = useReviewQueue(permissions.canReview);

  if (!permissions.loaded) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="clinical-review-queue">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (!permissions.canReview) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="clinical-review-queue">
        <EmptyState icon="lock-outline" title={t('screening.home.notForRole')} />
      </ScreenContainer>
    );
  }
  const items = queue.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <ScreenContainer edges={['left', 'right']} testID="clinical-review-queue">
      <AppText variant="body">{t('reviews.intro')}</AppText>
      {queue.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : queue.isError ? (
        <ErrorState message={t(apiErrorMessageKey(queue.error))} onRetry={() => void queue.refetch()} />
      ) : items.length === 0 ? (
        <AppText color="textSecondary" testID="clinical-review-queue-empty">
          {t('reviews.empty')}
        </AppText>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.childName}
              onPress={() => router.push(resultRoutes.review(item.id))}
              testID={`clinical-review-item-${item.id}`}
            >
              <AppCard style={styles.row}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{item.childName}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {t('reviews.itemLine', {
                      date: formatIndiaDate(item.createdAt),
                      version: item.screeningVersion,
                      status: t(`results.reviewStatus.${item.status}` as TranslationKey),
                    })}
                  </AppText>
                  {item.claimedByName ? (
                    <AppText variant="caption" color="textSecondary">
                      {item.claimedByMe
                        ? t('reviews.claimedByMe')
                        : t('reviews.claimedBy', { name: item.claimedByName })}
                    </AppText>
                  ) : null}
                  <StatusBadge
                    label={t(outcomeKey(item.overallOutcome))}
                    tone={OUTCOME_TONE[item.overallOutcome]}
                  />
                </View>
                <AppIcon name="chevron-right" color={colors.textSecondary} />
              </AppCard>
            </Pressable>
          ))}
          {queue.hasNextPage ? (
            <AppButton
              variant="secondary"
              label={t('screening.reviewQueue.loadMore')}
              loading={queue.isFetchingNextPage}
              onPress={() => void queue.fetchNextPage()}
              testID="clinical-review-more"
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
