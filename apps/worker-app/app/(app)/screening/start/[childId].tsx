import type { CategoryEligibility, ScreeningBlocker } from '@balswasthya/shared-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppText,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
} from '../../../../src/components';
import { useChild, useChildPermissions } from '../../../../src/features/children/hooks';
import { childRoutes } from '../../../../src/features/children/routes';
import { ConsentStatusBadge, reasonLabel } from '../../../../src/features/consent/ConsentStatusBadge';
import {
  CategoryCard,
  DemoContentBanner,
  NotADiagnosisNote,
  screeningAgeText,
} from '../../../../src/features/screening/components/ScreeningParts';
import {
  useApplySessionUpdate,
  useScreeningApi,
  useScreeningEligibility,
} from '../../../../src/features/screening/hooks';
import { screeningRoutes } from '../../../../src/features/screening/routes';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { isApiError } from '../../../../src/services/api/errors';
import { spacing } from '../../../../src/theme';
import { newSubmissionId } from '../../../../src/utils/submissionId';

const BLOCKER_KEYS: Record<ScreeningBlocker, TranslationKey> = {
  CONSENT_NOT_PERMITTED: 'screening.eligibility.blocker.CONSENT_NOT_PERMITTED',
  AGE_NOT_DETERMINABLE: 'screening.eligibility.blocker.AGE_NOT_DETERMINABLE',
  NO_CATEGORY_AVAILABLE: 'screening.eligibility.blocker.NO_CATEGORY_AVAILABLE',
  OPEN_SESSION_EXISTS: 'screening.eligibility.blocker.OPEN_SESSION_EXISTS',
};

const START_ERRORS: Record<string, TranslationKey> = {
  CONSENT_REQUIRED: 'screening.eligibility.blocker.CONSENT_NOT_PERMITTED',
  AGE_NOT_DETERMINABLE: 'screening.eligibility.blocker.AGE_NOT_DETERMINABLE',
  NO_CATEGORY_AVAILABLE: 'screening.eligibility.blocker.NO_CATEGORY_AVAILABLE',
};

function unavailableKey(c: CategoryEligibility): TranslationKey {
  return c.reason === 'AMBIGUOUS_PROTOCOL'
    ? 'screening.eligibility.unavailable.AMBIGUOUS_PROTOCOL'
    : 'screening.eligibility.unavailable.NO_PROTOCOL_FOR_AGE';
}

/**
 * Eligibility and consent check before a screening starts. Everything shown is decided by the
 * API (decision R); the app never bypasses a blocker. Starting creates a DRAFT session; the API
 * checks consent, scope and age again.
 */
export default function ScreeningEligibilityScreen() {
  const { childId = '' } = useLocalSearchParams<{ childId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const api = useScreeningApi();
  const apply = useApplySessionUpdate();
  const childPermissions = useChildPermissions();
  const child = useChild(childId);
  const eligibility = useScreeningEligibility(childId);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);
  // One submission id per attempt: a retry after a lost response returns the same session.
  const submissionId = useRef(newSubmissionId());

  if (eligibility.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-eligibility">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (eligibility.isError) {
    const notFound = isApiError(eligibility.error) && eligibility.error.status === 404;
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-eligibility">
        <ErrorState
          message={notFound ? t('children.profile.notFound') : t(apiErrorMessageKey(eligibility.error))}
          onRetry={notFound ? undefined : () => void eligibility.refetch()}
        />
      </ScreenContainer>
    );
  }

  const e = eligibility.data;
  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);
    setError(null);
    try {
      const response = await api.start({ clientOperationId: submissionId.current, childId });
      apply(response);
      router.replace(screeningRoutes.session(response.session.id));
    } catch (err) {
      if (isApiError(err) && err.code === 'OPEN_SESSION_EXISTS') {
        const sessionId = (err.details as { sessionId?: string } | undefined)?.sessionId;
        if (sessionId) {
          router.replace(screeningRoutes.session(sessionId));
          return;
        }
      }
      // A refused start used this id; the next attempt is a new submission.
      if (isApiError(err) && err.kind === 'http') submissionId.current = newSubmissionId();
      setError((isApiError(err) && err.code && START_ERRORS[err.code]) || apiErrorMessageKey(err));
      void eligibility.refetch();
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };

  return (
    <ScreenContainer edges={['left', 'right']} testID="screening-eligibility">
      <DemoContentBanner visible={e.usesUnapprovedContent} />
      <AppCard style={styles.card}>
        <AppText variant="subtitle">{child.data?.fullName ?? ''}</AppText>
        <AppText variant="body" testID="eligibility-age">
          {e.age ? screeningAgeText(t, e.age, e.dobIsEstimated) : t('screening.eligibility.ageUnknown')}
        </AppText>
        {e.dobIsEstimated ? (
          <InlineAlert
            tone="info"
            message={t('screening.eligibility.estimatedDob')}
            testID="eligibility-estimated"
          />
        ) : null}
      </AppCard>

      <SectionHeader title={t('screening.eligibility.consentTitle')} />
      <AppCard style={styles.card} testID="eligibility-consent">
        <ConsentStatusBadge status={e.consent} />
        {e.consent.reason ? (
          <AppText variant="bodySmall" color="textSecondary">
            {reasonLabel(t, e.consent.reason)}
          </AppText>
        ) : null}
        {!e.consent.permitted ? (
          <>
            <AppText variant="body">{t('screening.eligibility.consentExplain')}</AppText>
            {childPermissions.canRecordConsent ? (
              <AppButton
                variant="secondary"
                icon="file-sign"
                label={t('screening.eligibility.recordConsent')}
                onPress={() => router.push(childRoutes.recordConsent(childId))}
                testID="eligibility-record-consent"
              />
            ) : (
              <AppText variant="bodySmall" color="textSecondary">
                {t('screening.eligibility.askConsentRecorder')}
              </AppText>
            )}
          </>
        ) : null}
      </AppCard>

      {e.blockers
        .filter((b) => b !== 'CONSENT_NOT_PERMITTED')
        .map((b) => (
          <InlineAlert
            key={b}
            tone="warning"
            message={t(BLOCKER_KEYS[b])}
            testID={`eligibility-blocker-${b}`}
          />
        ))}
      {e.openSessionId ? (
        <PrimaryButton
          icon="play-circle-outline"
          label={t('screening.eligibility.resume')}
          onPress={() => router.replace(screeningRoutes.session(e.openSessionId!))}
          testID="eligibility-resume"
        />
      ) : null}

      <SectionHeader title={t('screening.eligibility.categoriesTitle')} />
      <View style={styles.list}>
        {e.categories.map((c) => (
          <CategoryCard
            key={c.category}
            category={c.category}
            state={c.available ? 'NOT_STARTED' : 'NOT_AVAILABLE'}
            unavailableReason={c.available ? undefined : t(unavailableKey(c))}
          />
        ))}
      </View>

      {error ? <InlineAlert tone="danger" message={t(error)} testID="eligibility-error" /> : null}
      {e.openSessionId ? null : (
        <PrimaryButton
          icon="stethoscope"
          label={t('screening.eligibility.start')}
          onPress={() => void start()}
          disabled={!e.canStart}
          loading={starting}
          testID="eligibility-start"
        />
      )}
      <NotADiagnosisNote />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  list: { gap: spacing.sm },
});
