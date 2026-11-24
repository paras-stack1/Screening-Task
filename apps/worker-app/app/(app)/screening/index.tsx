import type { ScreeningSessionSummary } from '@balswasthya/shared-contracts';
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
  MetricCard,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  type MetricState,
} from '../../../src/components';
import { formatIndiaDate } from '../../../src/features/children/labels';
import { NotADiagnosisNote } from '../../../src/features/screening/components/ScreeningParts';
import {
  useMyOpenSessions,
  useScreeningPermissions,
  useScreeningSummary,
} from '../../../src/features/screening/hooks';
import { resultRoutes } from '../../../src/features/results/routes';
import { screeningRoutes } from '../../../src/features/screening/routes';
import { useTranslation } from '../../../src/localization';
import { apiErrorMessageKey } from '../../../src/services/api/errorMessages';
import { colors, spacing, touchTarget } from '../../../src/theme';

/**
 * Screening home: the worker's own real counts, unfinished screenings to continue, and "Start
 * screening". No number is invented: a count that cannot be loaded is shown as an error.
 */
export default function ScreeningHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useScreeningPermissions();
  const summary = useScreeningSummary(permissions.canConduct);
  const open = useMyOpenSessions(permissions.canConduct);

  if (!permissions.loaded) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-home">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (!permissions.canConduct) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-home">
        <EmptyState icon="lock-outline" title={t('screening.home.notForRole')} />
      </ScreenContainer>
    );
  }

  const metric = (value: number | undefined): MetricState =>
    summary.isError
      ? { status: 'error' }
      : value === undefined
        ? { status: 'loading' }
        : { status: 'ready', value };
  const sessions = [...(open.inProgress.data?.items ?? []), ...(open.drafts.data?.items ?? [])];
  const listError = open.inProgress.error ?? open.drafts.error;
  const listLoading = open.inProgress.isPending || open.drafts.isPending;

  return (
    <ScreenContainer edges={['left', 'right']} testID="screening-home">
      <View style={styles.grid}>
        <MetricCard
          label={t('screening.home.completedToday')}
          icon="clipboard-check-outline"
          state={metric(summary.data?.completedToday)}
          testID="screening-metric-completed"
        />
        <MetricCard
          label={t('screening.home.inProgress')}
          icon="progress-clock"
          state={metric(summary.data?.inProgress)}
          testID="screening-metric-in-progress"
        />
        <MetricCard
          label={t('screening.home.drafts')}
          icon="file-document-edit-outline"
          state={metric(summary.data?.drafts)}
          testID="screening-metric-drafts"
        />
      </View>
      <PrimaryButton
        icon="stethoscope"
        label={t('screening.home.start')}
        onPress={() => router.push(screeningRoutes.selectChild)}
        testID="screening-start"
      />
      {permissions.canRead ? (
        <AppButton
          variant="secondary"
          icon="clipboard-pulse-outline"
          label={t('results.listTitle')}
          onPress={() => router.push(resultRoutes.list)}
          testID="screening-results"
        />
      ) : null}
      {permissions.canReview ? (
        <AppButton
          variant="secondary"
          icon="stethoscope"
          label={t('reviews.title')}
          accessibilityHint={t('reviews.hint')}
          onPress={() => router.push(resultRoutes.reviewQueue)}
          testID="screening-clinical-reviews"
        />
      ) : null}
      {permissions.canReview ? (
        <AppButton
          variant="secondary"
          icon="check-decagram-outline"
          label={t('screening.home.reviewQueue')}
          accessibilityHint={t('screening.home.reviewQueueHint')}
          onPress={() => router.push(screeningRoutes.reviewQueue)}
          testID="screening-review-queue"
        />
      ) : null}

      <SectionHeader title={t('screening.home.continueTitle')} />
      {listLoading ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : listError ? (
        <ErrorState
          message={t(apiErrorMessageKey(listError))}
          onRetry={() => {
            void open.inProgress.refetch();
            void open.drafts.refetch();
          }}
        />
      ) : sessions.length === 0 ? (
        <AppText color="textSecondary" testID="screening-none-open">
          {t('screening.home.noneOpen')}
        </AppText>
      ) : (
        sessions.map((s) => <OpenSessionRow key={s.id} session={s} />)
      )}
      <NotADiagnosisNote />
    </ScreenContainer>
  );
}

function OpenSessionRow({ session }: { session: ScreeningSessionSummary }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('screening.home.continueA11y', { name: session.childName })}
      onPress={() => router.push(screeningRoutes.session(session.id))}
      testID={`open-session-${session.id}`}
    >
      <AppCard style={styles.row}>
        <View style={styles.rowText}>
          <AppText variant="bodyStrong">{session.childName}</AppText>
          <AppText variant="bodySmall" color="textSecondary">
            {t('screening.home.startedOn', {
              date: formatIndiaDate(session.startedAt),
              count: session.categories.length,
            })}
          </AppText>
        </View>
        <AppIcon name="chevron-right" color={colors.textSecondary} />
      </AppCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touchTarget.primary },
  rowText: { flex: 1, gap: spacing.xxs },
});
