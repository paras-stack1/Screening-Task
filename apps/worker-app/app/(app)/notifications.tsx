import type { AppNotification } from '@balswasthya/shared-contracts';
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
} from '../../src/components';
import { formatIndiaDateTime } from '../../src/features/children/labels';
import { useMarkNotificationRead, useNotifications } from '../../src/features/results/hooks';
import { resultRoutes } from '../../src/features/results/routes';
import { useTranslation, type TranslationKey } from '../../src/localization';
import { apiErrorMessageKey } from '../../src/services/api/errorMessages';
import { colors, spacing } from '../../src/theme';

/**
 * In-app notifications (Step 7 decision S). Each notification carries only its type and a record
 * id: the text is generic and translated here, so no name or health detail is ever stored in or
 * shown by a notification. Opening one marks it read and, where a screen exists, opens the record
 * through the normal permission-checked API.
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const list = useNotifications();
  const markRead = useMarkNotificationRead();

  const open = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.entityType === 'clinicalReview') router.push(resultRoutes.review(n.entityId));
  };

  if (list.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="notifications-screen">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (list.isError) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="notifications-screen">
        <ErrorState message={t(apiErrorMessageKey(list.error))} onRetry={() => void list.refetch()} />
      </ScreenContainer>
    );
  }
  const items = list.data.pages.flatMap((p) => p.items);
  const unread = list.data.pages[0]?.unread ?? 0;
  if (items.length === 0) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="notifications-screen">
        <EmptyState
          icon="bell-outline"
          title={t('notifications.none.title')}
          message={t('notifications.none.message')}
        />
      </ScreenContainer>
    );
  }
  return (
    <ScreenContainer edges={['left', 'right']} testID="notifications-screen">
      <AppText variant="bodySmall" color="textSecondary" testID="notifications-unread">
        {t('notifications.unread', { count: unread })}
      </AppText>
      <View style={styles.list}>
        {items.map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={t(`notifications.type.${n.type}` as TranslationKey)}
            accessibilityState={{ selected: !n.readAt }}
            onPress={() => open(n)}
            testID={`notification-${n.id}`}
          >
            <AppCard style={[styles.row, !n.readAt && styles.unread]}>
              <AppIcon
                name={n.readAt ? 'bell-outline' : 'bell-ring-outline'}
                color={n.readAt ? colors.textSecondary : colors.primary}
              />
              <View style={styles.flex}>
                <AppText variant={n.readAt ? 'body' : 'bodyStrong'}>
                  {t(`notifications.type.${n.type}` as TranslationKey)}
                </AppText>
                <AppText variant="caption" color="textSecondary">
                  {formatIndiaDateTime(n.createdAt)}
                </AppText>
              </View>
            </AppCard>
          </Pressable>
        ))}
        {list.hasNextPage ? (
          <AppButton
            variant="secondary"
            label={t('screening.reviewQueue.loadMore')}
            loading={list.isFetchingNextPage}
            onPress={() => void list.fetchNextPage()}
            testID="notifications-more"
          />
        ) : null}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unread: { borderColor: colors.primary, borderWidth: 1 },
  flex: { flex: 1, gap: spacing.xxs },
});
