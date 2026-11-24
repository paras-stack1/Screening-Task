import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { ScreeningSessionDetail } from '@balswasthya/shared-contracts';
import {
  AppButton,
  AppText,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
} from '../../../../src/components';
import { formatIndiaDateTime } from '../../../../src/features/children/labels';
import { resultRoutes } from '../../../../src/features/results/routes';
import { SessionSummary } from '../../../../src/features/screening/components/SessionSummary';
import { useSessionWithProtocols } from '../../../../src/features/screening/hooks';
import { screeningRoutes } from '../../../../src/features/screening/routes';
import { useTranslation } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { isApiError } from '../../../../src/services/api/errors';
import { spacing } from '../../../../src/theme';

/**
 * Screening summary / details: what was recorded, by whom and when; categories assessed,
 * incomplete and not assessed; measurements. Read-only. Never a diagnosis or a recommendation.
 */
export default function ScreeningSummaryScreen() {
  const { sessionId = '', amended } = useLocalSearchParams<{ sessionId: string; amended?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const { session, protocols, isError, error, retry } = useSessionWithProtocols(sessionId);

  if (isError) {
    const notFound = isApiError(error) && error.status === 404;
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-summary">
        <ErrorState
          message={notFound ? t('screening.session.notFound') : t(apiErrorMessageKey(error))}
          onRetry={notFound ? undefined : retry}
        />
      </ScreenContainer>
    );
  }
  if (!session) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-summary">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={['left', 'right']} testID="screening-summary">
      {amended === '1' && session.currentVersion > 1 ? (
        <InlineAlert
          tone="info"
          message={t('screening.amend.saved', { version: session.currentVersion })}
          testID="summary-amendment-saved"
        />
      ) : null}
      <SessionSummary session={session} protocols={protocols} />
      <AmendmentEntry session={session} onAmend={() => router.push(screeningRoutes.amend(session.id))} />
      <View style={styles.actions}>
        {session.canEdit ? (
          <PrimaryButton
            icon="play-circle-outline"
            label={t('screening.summary.continue')}
            onPress={() => router.replace(screeningRoutes.session(session.id))}
            testID="summary-continue"
          />
        ) : null}
        {session.status === 'COMPLETED' ? (
          <AppButton
            variant="secondary"
            icon="clipboard-pulse-outline"
            label={t('results.open')}
            onPress={() => router.push(resultRoutes.sessionResult(session.id))}
            testID="summary-result"
          />
        ) : null}
        <AppButton
          variant="secondary"
          icon="history"
          label={t('screening.history.open')}
          onPress={() => router.push(screeningRoutes.history(session.childId))}
          testID="summary-history"
        />
        <AppButton
          variant="secondary"
          icon="home-outline"
          label={t('screening.summary.home')}
          onPress={() => router.replace(screeningRoutes.home)}
          testID="summary-home"
        />
      </View>
    </ScreenContainer>
  );
}

/**
 * Step 6G-2: who may amend this completed screening, and until when. The API decides (canAmend,
 * amendBasis, amendableUntil); this only explains it. The worker who did the screening sees when
 * their 7 days end, or that they have ended.
 */
function AmendmentEntry({ session, onAmend }: { session: ScreeningSessionDetail; onAmend: () => void }) {
  const { t } = useTranslation();
  if (session.status !== 'COMPLETED') return null;
  if (!session.canAmend) {
    return session.isMine ? (
      <InlineAlert tone="info" message={t('screening.amend.windowClosed')} testID="summary-amend-closed" />
    ) : null;
  }
  return (
    <View style={styles.actions} testID="summary-amend">
      <AppText variant="bodySmall" color="textSecondary" testID="summary-amend-window">
        {session.amendBasis === 'CONDUCTOR_WITHIN_WINDOW' && session.amendableUntil
          ? t('screening.amend.untilConductor', { date: formatIndiaDateTime(session.amendableUntil) })
          : t('screening.amend.asMedicalOfficer')}
      </AppText>
      <AppButton
        variant="secondary"
        icon="pencil-outline"
        label={t('screening.amend.open')}
        onPress={onAmend}
        testID="summary-amend-open"
      />
    </View>
  );
}

const styles = StyleSheet.create({ actions: { gap: spacing.sm } });
