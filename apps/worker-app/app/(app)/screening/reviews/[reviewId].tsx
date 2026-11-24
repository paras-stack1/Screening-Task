import {
  FOUR_D_CATEGORIES,
  REFERRAL_PRIORITIES,
  REVIEW_DECISIONS,
  type ClinicalReviewDetail,
  type FourDCategoryCode,
  type ReferralPriority,
  type ReviewDecisionRequest,
} from '@balswasthya/shared-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
} from '../../../../src/components';
import { formatIndiaDateTime } from '../../../../src/features/children/labels';
import { ResultView } from '../../../../src/features/results/components/ResultView';
import { useReview, useReviewActions } from '../../../../src/features/results/hooks';
import { useScreeningPermissions } from '../../../../src/features/screening/hooks';
import { categoryTitleKey } from '../../../../src/features/screening/labels';
import { screeningRoutes } from '../../../../src/features/screening/routes';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { spacing } from '../../../../src/theme';

type Decision = ReviewDecisionRequest['decision'];

/**
 * Clinical review of one screening result (Step 7 decisions G-I, K). The medical officer claims
 * the review, reads the result (and the recorded answers through "View recorded answers"), and
 * records a decision. Identity, permission, claim and version are checked by the API; this
 * screen only shows what the API allows (canClaim / canRelease / canDecide).
 */
export default function ReviewScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { reviewId = '' } = useLocalSearchParams<{ reviewId: string }>();
  const permissions = useScreeningPermissions();
  const review = useReview(reviewId, permissions.canReview);
  const actions = useReviewActions(reviewId);

  if (!permissions.loaded || (permissions.canReview && review.isPending)) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="clinical-review">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (!permissions.canReview) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="clinical-review">
        <EmptyState icon="lock-outline" title={t('screening.home.notForRole')} />
      </ScreenContainer>
    );
  }
  if (review.isError) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="clinical-review">
        <ErrorState message={t(apiErrorMessageKey(review.error))} onRetry={() => void review.refetch()} />
      </ScreenContainer>
    );
  }
  const r = review.data!.review;
  const mutationError = actions.claim.error ?? actions.release.error ?? actions.decide.error;

  return (
    <ScreenContainer edges={['left', 'right']} testID="clinical-review">
      <AppText variant="title">{r.childName}</AppText>
      <AppText variant="bodySmall" color="textSecondary" testID="clinical-review-status">
        {t(`results.reviewStatus.${r.status}` as TranslationKey)}
        {r.claimedByName
          ? ` · ${r.claimedByMe ? t('reviews.claimedByMe') : t('reviews.claimedBy', { name: r.claimedByName })}`
          : ''}
      </AppText>
      {r.conductedByReviewer ? (
        <InlineAlert tone="warning" message={t('reviews.ownScreening')} testID="clinical-review-own" />
      ) : null}
      {mutationError ? (
        <InlineAlert
          tone="danger"
          message={t(apiErrorMessageKey(mutationError))}
          testID="clinical-review-error"
        />
      ) : null}

      <View style={styles.actions}>
        {r.canClaim ? (
          <PrimaryButton
            icon="account-check-outline"
            label={t('reviews.claim')}
            loading={actions.claim.isPending}
            onPress={() => actions.claim.mutate(r.version)}
            testID="clinical-review-claim"
          />
        ) : null}
        {r.canRelease ? (
          <AppButton
            variant="secondary"
            label={t('reviews.release')}
            loading={actions.release.isPending}
            onPress={() => actions.release.mutate(r.version)}
            testID="clinical-review-release"
          />
        ) : null}
        <AppButton
          variant="secondary"
          icon="clipboard-text-outline"
          label={t('results.viewAnswers')}
          onPress={() => router.push(screeningRoutes.summary(r.sessionId))}
          testID="clinical-review-answers"
        />
      </View>

      {r.canDecide ? (
        <DecisionForm
          review={r}
          pending={actions.decide.isPending}
          onSubmit={(b) => actions.decide.mutate(b)}
        />
      ) : null}

      <ResultView run={r.result} />

      <SectionHeader title={t('reviews.history')} />
      <View style={styles.list} testID="clinical-review-history">
        {r.history.map((h, i) => (
          <AppCard key={`${h.occurredAt}-${i}`} style={styles.card}>
            <AppText variant="bodySmall">
              {t('reviews.historyLine', {
                status: t(`results.reviewStatus.${h.toStatus}` as TranslationKey),
                date: formatIndiaDateTime(h.occurredAt),
                name: h.actorName ?? t('reviews.system'),
              })}
            </AppText>
            {h.decision ? (
              <AppText variant="caption" color="textSecondary">
                {t(`results.decision.${h.decision}` as TranslationKey)}
              </AppText>
            ) : null}
            {h.notes ? <AppText variant="caption">{h.notes}</AppText> : null}
          </AppCard>
        ))}
      </View>
    </ScreenContainer>
  );
}

function DecisionForm({
  review,
  pending,
  onSubmit,
}: {
  review: ClinicalReviewDetail;
  pending: boolean;
  onSubmit: (body: ReviewDecisionRequest) => void;
}) {
  const { t } = useTranslation();
  const [decision, setDecision] = useState<Decision | ''>('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<FourDCategoryCode | ''>('');
  const [priority, setPriority] = useState<ReferralPriority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!decision) return setError(t('reviews.form.chooseDecision'));
    if (decision !== 'ACCEPT_RESULT' && notes.trim().length < 3)
      return setError(t('reviews.form.notesRequired'));
    if (decision === 'RECOMMEND_REFERRAL' && (!category || !priority))
      return setError(t('reviews.form.referralRequired'));
    if (decision === 'REQUEST_ADDITIONAL_SCREENING' && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())) {
      return setError(t('reviews.form.dueDateRequired'));
    }
    setError(null);
    onSubmit({
      expectedVersion: review.version,
      decision,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(decision === 'RECOMMEND_REFERRAL' && category && priority
        ? { referral: { category, priority } }
        : {}),
      ...(decision === 'REQUEST_ADDITIONAL_SCREENING' ? { followUp: { dueDate: dueDate.trim() } } : {}),
    });
  };

  return (
    <AppCard style={styles.card} testID="clinical-review-form">
      <SectionHeader title={t('reviews.form.title')} />
      <ChoiceGroup<Decision>
        label={t('reviews.form.decision')}
        options={REVIEW_DECISIONS.map((d) => ({
          value: d,
          label: t(`results.decision.${d}` as TranslationKey),
        }))}
        value={decision}
        onChange={setDecision}
        testID="clinical-review-decision"
      />
      {decision === 'RECOMMEND_REFERRAL' ? (
        <>
          <InlineAlert tone="warning" message={t('reviews.emergency')} testID="clinical-review-emergency" />
          <ChoiceGroup<FourDCategoryCode>
            label={t('reviews.form.category')}
            options={FOUR_D_CATEGORIES.map((c) => ({ value: c, label: t(categoryTitleKey(c)) }))}
            value={category}
            onChange={setCategory}
            testID="clinical-review-category"
          />
          <ChoiceGroup<ReferralPriority>
            label={t('reviews.form.priority')}
            hint={t('reviews.form.priorityHint')}
            options={REFERRAL_PRIORITIES.map((p) => ({
              value: p,
              label: t(`results.priority.${p}` as TranslationKey),
            }))}
            value={priority}
            onChange={setPriority}
            testID="clinical-review-priority"
          />
          <AppText variant="caption" color="textSecondary">
            {t('reviews.form.facilityLater')}
          </AppText>
        </>
      ) : null}
      {decision === 'REQUEST_ADDITIONAL_SCREENING' ? (
        <AppInput
          label={t('reviews.form.dueDate')}
          hint={t('reviews.form.dueDateHint')}
          value={dueDate}
          onChangeText={setDueDate}
          keyboardType="numbers-and-punctuation"
          testID="clinical-review-due-date"
        />
      ) : null}
      <AppInput
        label={decision === 'ACCEPT_RESULT' ? t('reviews.form.notesOptional') : t('reviews.form.notes')}
        hint={t('reviews.form.notesHint')}
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={1000}
        testID="clinical-review-notes"
      />
      {error ? <InlineAlert tone="danger" message={error} testID="clinical-review-form-error" /> : null}
      <PrimaryButton
        icon="content-save-outline"
        label={t('reviews.form.save')}
        loading={pending}
        onPress={submit}
        testID="clinical-review-save"
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
});
