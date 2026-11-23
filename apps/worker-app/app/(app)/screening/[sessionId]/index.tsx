import { FOUR_D_CATEGORIES, type FourDCategoryCode } from '@balswasthya/shared-contracts';
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
  StatusBadge,
} from '../../../../src/components';
import { formatIndiaDate } from '../../../../src/features/children/labels';
import { CancelSessionCard } from '../../../../src/features/screening/components/CancelSessionCard';
import {
  CategoryCard,
  DemoContentBanner,
  NotADiagnosisNote,
  screeningAgeText,
  type CategoryState,
} from '../../../../src/features/screening/components/ScreeningParts';
import {
  useApplySessionUpdate,
  useRefetchSession,
  useScreeningApi,
  useScreeningEligibility,
  useScreeningSession,
} from '../../../../src/features/screening/hooks';
import { screeningRoutes } from '../../../../src/features/screening/routes';
import { isVersionConflict, sessionErrorKey } from '../../../../src/features/screening/errors';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { isApiError } from '../../../../src/services/api/errors';
import { spacing } from '../../../../src/theme';

/**
 * Screening session hub: the four categories with their WORKFLOW state (never a health result),
 * measurements, and what is still open. Answers are saved section by section, so the worker can
 * leave at any time and continue later from the screening home.
 */
export default function ScreeningSessionScreen() {
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const api = useScreeningApi();
  const apply = useApplySessionUpdate();
  const refetch = useRefetchSession(sessionId);
  const session = useScreeningSession(sessionId);
  const eligibility = useScreeningEligibility(session.data?.childId ?? '');
  const [busy, setBusy] = useState<FourDCategoryCode | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  if (session.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-session">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (session.isError) {
    const notFound = isApiError(session.error) && session.error.status === 404;
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-session">
        <ErrorState
          message={notFound ? t('screening.session.notFound') : t(apiErrorMessageKey(session.error))}
          onRetry={notFound ? undefined : () => void session.refetch()}
        />
      </ScreenContainer>
    );
  }

  const s = session.data;
  const startCategory = async (category: FourDCategoryCode) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(category);
    setError(null);
    try {
      apply(await api.startCategory(s.id, s.version, category));
      router.push(screeningRoutes.category(s.id, category));
    } catch (err) {
      setError(sessionErrorKey(err));
      if (isVersionConflict(err)) void refetch();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const stateOf = (category: FourDCategoryCode): CategoryState => {
    const started = s.sessionCategories.find((c) => c.category === category);
    if (started) return started.status;
    const available = eligibility.data?.categories.find((c) => c.category === category)?.available;
    return available === false ? 'NOT_AVAILABLE' : 'NOT_STARTED';
  };
  const currentMeasurements = s.measurements.filter((m) => m.isCurrent).length;
  const statusKey = `screening.sessionStatus.${s.status}` as TranslationKey;

  return (
    <ScreenContainer edges={['left', 'right']} testID="screening-session">
      <DemoContentBanner
        visible={s.usesUnapprovedContent || Boolean(eligibility.data?.usesUnapprovedContent)}
      />
      <AppCard style={styles.card}>
        <AppText variant="subtitle">{s.childName}</AppText>
        <AppText variant="body" testID="session-age">
          {screeningAgeText(t, s.ageAtStart, s.dobEstimatedAtStart)}
        </AppText>
        <AppText variant="bodySmall" color="textSecondary">
          {t('screening.session.startedBy', { date: formatIndiaDate(s.startedAt), name: s.conductedByName })}
        </AppText>
        <StatusBadge label={t(statusKey)} tone="neutral" />
      </AppCard>

      {!s.canEdit ? (
        <InlineAlert
          tone="info"
          message={t(s.isMine ? 'screening.session.final' : 'screening.session.readOnly')}
          testID="session-read-only"
        />
      ) : null}
      {error ? <InlineAlert tone="danger" message={t(error)} testID="session-error" /> : null}

      <SectionHeader
        title={t('screening.session.categoriesTitle')}
        subtitle={t('screening.session.categoriesHint')}
      />
      <View style={styles.list}>
        {FOUR_D_CATEGORIES.map((category) => {
          const state = stateOf(category);
          const started = s.sessionCategories.find((c) => c.category === category);
          const canStart = s.canEdit && state === 'NOT_STARTED';
          const canOpen = Boolean(started);
          return (
            <CategoryCard
              key={category}
              category={category}
              state={state}
              completeness={started?.completeness}
              unavailableReason={
                state === 'NOT_AVAILABLE'
                  ? t('screening.eligibility.unavailable.NO_PROTOCOL_FOR_AGE')
                  : undefined
              }
              loading={busy === category}
              actionLabel={
                canStart
                  ? t('screening.session.startCategory')
                  : canOpen
                    ? t(
                        s.canEdit && state === 'IN_PROGRESS'
                          ? 'screening.session.continueCategory'
                          : 'screening.session.viewCategory',
                      )
                    : undefined
              }
              onPress={
                canStart
                  ? () => void startCategory(category)
                  : canOpen
                    ? () => router.push(screeningRoutes.category(s.id, category))
                    : undefined
              }
            />
          );
        })}
      </View>

      <SectionHeader title={t('screening.measurement.title')} />
      <AppCard style={styles.card}>
        <AppText variant="body" testID="session-measurement-count">
          {t('screening.session.measurementCount', { count: currentMeasurements })}
        </AppText>
        <AppButton
          variant="secondary"
          icon="scale-bathroom"
          label={t(s.canEdit ? 'screening.session.recordMeasurements' : 'screening.session.viewMeasurements')}
          onPress={() => router.push(screeningRoutes.measurements(s.id))}
          testID="session-measurements"
        />
      </AppCard>

      {s.canEdit ? (
        <>
          <AppText variant="bodySmall" color="textSecondary" testID="session-saved-note">
            {t('screening.session.savedNote')}
          </AppText>
          <PrimaryButton
            icon="clipboard-check-outline"
            label={t('screening.session.review')}
            onPress={() => router.push(screeningRoutes.review(s.id))}
            testID="session-review"
          />
          <CancelSessionCard session={s} />
        </>
      ) : (
        <AppButton
          variant="secondary"
          icon="file-document-outline"
          label={t('screening.session.viewSummary')}
          onPress={() => router.push(screeningRoutes.summary(s.id))}
          testID="session-view-summary"
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
