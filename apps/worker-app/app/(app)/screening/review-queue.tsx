import type { AmendmentQueueResponse } from '@balswasthya/shared-contracts';
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
} from '../../../src/components';
import { formatIndiaDate } from '../../../src/features/children/labels';
import { useAmendmentQueue, useScreeningPermissions } from '../../../src/features/screening/hooks';
import { screeningRoutes } from '../../../src/features/screening/routes';
import { useTranslation, type TranslationKey } from '../../../src/localization';
import { apiErrorMessageKey } from '../../../src/services/api/errorMessages';
import { colors, spacing } from '../../../src/theme';

type QueueItem = AmendmentQueueResponse['items'][number];

/**
 * Medical officer (screening.review): amendments of completed screenings that changed answers or
 * measurements and wait for review (decision G6). Each item opens the screening summary, where
 * the change is shown as old -> new and can be marked as reviewed. The API limits the list to the
 * officer's own areas.
 */
export default function AmendmentReviewQueueScreen() {
  const { t } = useTranslation();
  const permissions = useScreeningPermissions();
  const queue = useAmendmentQueue(permissions.canReview);

  if (!permissions.loaded) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="review-queue">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (!permissions.canReview) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="review-queue">
        <EmptyState icon="lock-outline" title={t('screening.home.notForRole')} />
      </ScreenContainer>
    );
  }

  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <ScreenContainer edges={['left', 'right']} testID="review-queue">
      <AppText variant="body">{t('screening.reviewQueue.intro')}</AppText>
      {queue.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : queue.isError ? (
        <ErrorState message={t(apiErrorMessageKey(queue.error))} onRetry={() => void queue.refetch()} />
      ) : items.length === 0 ? (
        <AppText color="textSecondary" testID="review-queue-empty">
          {t('screening.reviewQueue.empty')}
        </AppText>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <QueueRow key={item.amendmentId} item={item} />
          ))}
          {queue.hasNextPage ? (
            <AppButton
              variant="secondary"
              label={t('screening.reviewQueue.loadMore')}
              loading={queue.isFetchingNextPage}
              onPress={() => void queue.fetchNextPage()}
              testID="review-queue-more"
            />
          ) : null}
        </View>
      )}
    </ScreenContainer>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.childName}
      onPress={() => router.push(screeningRoutes.summary(item.sessionId))}
      testID={`review-queue-item-${item.amendmentId}`}
    >
      <AppCard style={styles.row}>
        <View style={styles.rowText}>
          <AppText variant="bodyStrong">{item.childName}</AppText>
          <AppText variant="bodySmall" color="textSecondary">
            {t('screening.reviewQueue.item', {
              version: item.sequence + 1,
              count: item.changeCount,
              date: formatIndiaDate(item.amendedAt),
              name: item.amendedByName,
            })}
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {t(`screening.amendments.basis.${item.basis}` as TranslationKey)}
          </AppText>
        </View>
        <AppIcon name="chevron-right" color={colors.textSecondary} />
      </AppCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowText: { flex: 1, gap: spacing.xxs },
});
