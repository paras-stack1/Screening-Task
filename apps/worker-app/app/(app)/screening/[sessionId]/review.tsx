import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  ConfirmationDialog,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
} from '../../../../src/components';
import { SessionSummary } from '../../../../src/features/screening/components/SessionSummary';
import { isVersionConflict, sessionErrorKey } from '../../../../src/features/screening/errors';
import {
  useApplySessionUpdate,
  useRefetchSession,
  useScreeningApi,
  useSessionWithProtocols,
} from '../../../../src/features/screening/hooks';
import { categoryTitleKey } from '../../../../src/features/screening/labels';
import { screeningRoutes } from '../../../../src/features/screening/routes';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { spacing } from '../../../../src/theme';

/**
 * Review before completing (decision N). Completion needs at least one finished area; areas that
 * were started but not finished stay "incomplete", areas never started are "not assessed". The API
 * makes completion transactional and idempotent; a completed screening can no longer be changed.
 */
export default function ScreeningReviewScreen() {
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const api = useScreeningApi();
  const apply = useApplySessionUpdate();
  const refetch = useRefetchSession(sessionId);
  const { session, protocols, isError, error, retry } = useSessionWithProtocols(sessionId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  if (isError) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-review">
        <ErrorState message={t(apiErrorMessageKey(error))} onRetry={retry} />
      </ScreenContainer>
    );
  }
  if (!session) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-review">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }

  const s = session;
  const finished = s.sessionCategories.filter((c) => c.status === 'COMPLETED');
  const incomplete = s.sessionCategories.filter((c) => c.status !== 'COMPLETED');

  const complete = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.complete(s.id, s.version);
      apply(response);
      setConfirming(false);
      router.replace(screeningRoutes.summary(s.id));
    } catch (err) {
      setConfirming(false);
      if (isVersionConflict(err)) void refetch();
      setMessage(sessionErrorKey(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <ScreenContainer edges={['left', 'right']} testID="screening-review">
      {!s.canEdit ? (
        <InlineAlert tone="info" message={t('screening.session.final')} testID="review-read-only" />
      ) : finished.length === 0 ? (
        <InlineAlert
          tone="warning"
          message={t('screening.review.needOneFinished')}
          testID="review-none-finished"
        />
      ) : (
        <InlineAlert tone="info" message={t('screening.review.intro')} />
      )}
      {s.canEdit && incomplete.length > 0 ? (
        <InlineAlert
          tone="warning"
          message={t('screening.review.incompleteWarning', {
            areas: incomplete.map((c) => t(categoryTitleKey(c.category))).join(', '),
          })}
          testID="review-incomplete"
        />
      ) : null}
      {message ? <InlineAlert tone="danger" message={t(message)} testID="review-error" /> : null}

      <SessionSummary session={s} protocols={protocols} />

      {s.canEdit ? (
        <View style={styles.actions}>
          <PrimaryButton
            icon="check-all"
            label={t('screening.review.complete')}
            onPress={() => setConfirming(true)}
            disabled={finished.length === 0}
            testID="review-complete"
          />
          <AppButton
            variant="secondary"
            icon="arrow-left"
            label={t('screening.review.backToScreening')}
            onPress={() => router.back()}
            testID="review-back"
          />
        </View>
      ) : null}

      <ConfirmationDialog
        visible={confirming}
        title={t('screening.review.confirmTitle')}
        message={t('screening.review.confirmMessage')}
        confirmLabel={t('screening.review.complete')}
        cancelLabel={t('common.cancel')}
        confirming={busy}
        onConfirm={() => void complete()}
        onCancel={() => setConfirming(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({ actions: { gap: spacing.sm } });
