import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  ErrorState,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
} from '../../../../src/components';
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
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
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
      <SessionSummary session={session} protocols={protocols} />
      <View style={styles.actions}>
        {session.canEdit ? (
          <PrimaryButton
            icon="play-circle-outline"
            label={t('screening.summary.continue')}
            onPress={() => router.replace(screeningRoutes.session(session.id))}
            testID="summary-continue"
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

const styles = StyleSheet.create({ actions: { gap: spacing.sm } });
