import type { ScreeningSessionSummary } from '@balswasthya/shared-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppIcon,
  AppText,
  EmptyState,
  ErrorState,
  LoadingIndicator,
  ScreenContainer,
  StatusBadge,
} from '../../../../src/components';
import { useChild } from '../../../../src/features/children/hooks';
import { formatIndiaDate } from '../../../../src/features/children/labels';
import { DemoContentBanner } from '../../../../src/features/screening/components/ScreeningParts';
import { useChildScreeningHistory } from '../../../../src/features/screening/hooks';
import { categoryTitleKey } from '../../../../src/features/screening/labels';
import { screeningRoutes } from '../../../../src/features/screening/routes';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { isApiError } from '../../../../src/services/api/errors';
import { colors, radius, spacing, touchTarget } from '../../../../src/theme';

/**
 * A child's screening history, newest first (paginated by the API, 20 per page). Completed and
 * cancelled screenings open their summary; unfinished ones open the session.
 */
export default function ScreeningHistoryScreen() {
  const { childId = '' } = useLocalSearchParams<{ childId: string }>();
  const { t } = useTranslation();
  const child = useChild(childId);
  const history = useChildScreeningHistory(childId);
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ScreenContainer edges={['left', 'right']} testID="screening-history">
      <AppText variant="subtitle">{child.data?.fullName ?? ''}</AppText>
      <DemoContentBanner visible={items.some((i) => i.usesUnapprovedContent)} />
      {history.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : history.isError && items.length === 0 ? (
        <ErrorState
          message={
            isApiError(history.error) && history.error.status === 404
              ? t('children.profile.notFound')
              : t(apiErrorMessageKey(history.error))
          }
          onRetry={() => void history.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="clipboard-text-outline"
          title={t('screening.history.empty')}
          testID="history-empty"
        />
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <HistoryRow key={item.id} item={item} />
          ))}
          {history.hasNextPage ? (
            <AppButton
              variant="secondary"
              label={t('children.list.loadMore')}
              onPress={() => void history.fetchNextPage()}
              loading={history.isFetchingNextPage}
              testID="history-load-more"
            />
          ) : null}
        </View>
      )}
    </ScreenContainer>
  );
}

function HistoryRow({ item }: { item: ScreeningSessionSummary }) {
  const { t } = useTranslation();
  const router = useRouter();
  const open = item.status === 'DRAFT' || item.status === 'IN_PROGRESS';
  const finished = item.categories.filter((c) => c.status === 'COMPLETED');
  const areas = finished.map((c) => t(categoryTitleKey(c.category))).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('screening.history.rowA11y', {
        date: formatIndiaDate(item.startedAt),
        status: t(`screening.sessionStatus.${item.status}` as TranslationKey),
      })}
      onPress={() =>
        router.push(open && item.isMine ? screeningRoutes.session(item.id) : screeningRoutes.summary(item.id))
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`history-row-${item.id}`}
    >
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">{formatIndiaDate(item.startedAt)}</AppText>
        <StatusBadge label={t(`screening.sessionStatus.${item.status}` as TranslationKey)} tone="neutral" />
        <AppText variant="bodySmall" color="textSecondary">
          {finished.length > 0
            ? t('screening.history.areasFinished', { areas })
            : t('screening.history.noAreasFinished')}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {t('screening.history.by', { name: item.conductedByName })}
        </AppText>
      </View>
      <AppIcon name="chevron-right" color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.primarySurface },
  rowText: { flex: 1, gap: spacing.xxs },
});
