import type { FollowUpDetail } from '@balswasthya/shared-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  StatusBadge,
} from '../../../../src/components';
import { formatIndiaDate, formatIndiaDateTime } from '../../../../src/features/children/labels';
import { ReasonAction } from '../../../../src/features/referrals/components/ReferralParts';
import { useFollowUp, useReferralMutation, useReferralsApi } from '../../../../src/features/referrals/hooks';
import { followUpStatusKey, indiaToday } from '../../../../src/features/referrals/labels';
import { referralRoutes } from '../../../../src/features/referrals/routes';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { spacing } from '../../../../src/theme';

const day = (date: string) => formatIndiaDate(`${date}T00:00:00+05:30`);

/**
 * One follow-up task (Step 7F; decisions Q, R): details, history and only the actions the API
 * allows. Completing a follow-up never changes or closes the referral.
 */
export default function FollowUpScreen() {
  const { t } = useTranslation();
  const { followUpId = '' } = useLocalSearchParams<{ followUpId: string }>();
  const followUp = useFollowUp(followUpId);
  if (followUp.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="follow-up-detail">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (followUp.isError) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="follow-up-detail">
        <ErrorState message={t(apiErrorMessageKey(followUp.error))} onRetry={() => void followUp.refetch()} />
      </ScreenContainer>
    );
  }
  return <FollowUpView f={followUp.data.followUp} />;
}

function FollowUpView({ f }: { f: FollowUpDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const api = useReferralsApi();
  const run = useReferralMutation((fn: () => Promise<unknown>) => fn());
  const [outcome, setOutcome] = useState('');
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <ScreenContainer edges={['left', 'right']} testID="follow-up-detail">
      <AppText variant="title">{f.childName}</AppText>
      <View style={styles.row}>
        <StatusBadge label={t(followUpStatusKey(f.status))} tone="info" />
        {f.overdue ? <StatusBadge label={t('followUps.overdue')} tone="danger" /> : null}
      </View>
      <AppText variant="bodyStrong">{t(`followUps.reason.${f.reasonCode}` as TranslationKey)}</AppText>
      <AppText variant="bodySmall" testID="follow-up-due">
        {t('followUps.due', { date: day(f.dueDate) })}
      </AppText>
      <AppText variant="bodySmall">
        {f.assignedToName ? t('followUps.assignedTo', { name: f.assignedToName }) : t('followUps.unassigned')}
      </AppText>
      {f.reasonNote ? <AppText variant="bodySmall">{f.reasonNote}</AppText> : null}
      {f.nextAction ? (
        <AppText variant="bodySmall">{t('followUps.nextAction', { text: f.nextAction })}</AppText>
      ) : null}
      {f.outcomeNote ? (
        <AppText variant="bodySmall" testID="follow-up-outcome">
          {t('followUps.outcome', { text: f.outcomeNote })}
        </AppText>
      ) : null}
      {f.referralId ? (
        <AppButton
          variant="secondary"
          label={t('followUps.openReferral')}
          onPress={() => router.push(referralRoutes.referral(f.referralId!))}
          testID="follow-up-referral"
        />
      ) : null}
      {run.error || localError ? (
        <InlineAlert
          tone="danger"
          message={localError ?? t(apiErrorMessageKey(run.error))}
          testID="follow-up-error"
        />
      ) : null}

      <View style={styles.actions}>
        {f.actions.start ? (
          <PrimaryButton
            label={t('followUps.start')}
            loading={run.isPending}
            onPress={() => run.mutate(() => api.startFollowUp(f.id, f.version))}
            testID="follow-up-start"
          />
        ) : null}
        {f.actions.complete ? (
          completeOpen ? (
            <AppCard style={styles.card} testID="follow-up-complete-form">
              <AppInput
                label={t('followUps.outcomeLabel')}
                hint={t('referrals.reasonHint')}
                value={outcome}
                onChangeText={setOutcome}
                multiline
                maxLength={1000}
                testID="follow-up-outcome-input"
              />
              <AppText variant="caption" color="textSecondary">
                {t('followUps.completeNote')}
              </AppText>
              <PrimaryButton
                label={t('followUps.complete')}
                loading={run.isPending}
                onPress={() => {
                  if (outcome.trim().length < 3) return setLocalError(t('followUps.outcomeRequired'));
                  setLocalError(null);
                  run.mutate(() =>
                    api.completeFollowUp(f.id, { expectedVersion: f.version, outcomeNote: outcome.trim() }),
                  );
                }}
                testID="follow-up-complete-confirm"
              />
            </AppCard>
          ) : (
            <AppButton
              variant="primary"
              label={t('followUps.complete')}
              onPress={() => setCompleteOpen(true)}
              testID="follow-up-complete"
            />
          )
        ) : null}
        {f.actions.reschedule ? (
          rescheduleOpen ? (
            <AppCard style={styles.card} testID="follow-up-reschedule-form">
              <AppInput
                label={t('followUps.new.dueDate')}
                hint={t('followUps.new.dueHint', { today: indiaToday() })}
                value={newDate}
                onChangeText={setNewDate}
                testID="follow-up-reschedule-date"
              />
              <AppInput
                label={t('followUps.rescheduleReason')}
                value={reason}
                onChangeText={setReason}
                maxLength={1000}
                testID="follow-up-reschedule-reason"
              />
              <PrimaryButton
                label={t('followUps.reschedule')}
                loading={run.isPending}
                onPress={() => {
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate.trim()) || reason.trim().length < 3) {
                    return setLocalError(t('followUps.rescheduleRequired'));
                  }
                  setLocalError(null);
                  run.mutate(() => api.rescheduleFollowUp(f.id, f.version, newDate.trim(), reason.trim()));
                }}
                testID="follow-up-reschedule-confirm"
              />
            </AppCard>
          ) : (
            <AppButton
              variant="secondary"
              label={t('followUps.reschedule')}
              onPress={() => setRescheduleOpen(true)}
              testID="follow-up-reschedule"
            />
          )
        ) : null}
        {f.actions.miss ? (
          <ReasonAction
            label={t('followUps.miss')}
            reasonLabel={t('followUps.missReason')}
            pending={run.isPending}
            onSubmit={(why) => run.mutate(() => api.missFollowUp(f.id, f.version, why))}
            testID="follow-up-miss"
          />
        ) : null}
        {f.actions.cancel ? (
          <ReasonAction
            label={t('followUps.cancel')}
            reasonLabel={t('followUps.cancelReason')}
            variant="danger"
            pending={run.isPending}
            onSubmit={(why) => run.mutate(() => api.cancelFollowUp(f.id, f.version, why))}
            testID="follow-up-cancel"
          />
        ) : null}
      </View>

      <SectionHeader title={t('followUps.history')} />
      <View style={styles.list} testID="follow-up-history">
        {f.history.map((h, i) => (
          <AppCard key={`${h.occurredAt}-${i}`} style={styles.card}>
            <AppText variant="bodyStrong">{t(`followUps.event.${h.type}` as TranslationKey)}</AppText>
            <AppText variant="caption" color="textSecondary">
              {t('referrals.detail.eventMeta', {
                date: formatIndiaDateTime(h.occurredAt),
                name: h.actorName,
              })}
            </AppText>
            {h.newDueDate && h.oldDueDate ? (
              <AppText variant="caption">
                {t('followUps.moved', { from: day(h.oldDueDate), to: day(h.newDueDate) })}
              </AppText>
            ) : null}
            {h.assignedToName ? (
              <AppText variant="caption">{t('followUps.assignedTo', { name: h.assignedToName })}</AppText>
            ) : null}
            {h.reason ? <AppText variant="bodySmall">{h.reason}</AppText> : null}
          </AppCard>
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { gap: spacing.sm },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
});
