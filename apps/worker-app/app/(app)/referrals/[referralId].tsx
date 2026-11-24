import {
  FOLLOW_UP_REASON_CODES,
  REFERRAL_PRIORITIES,
  TRACKING_SOURCES,
  type ReferralDetail,
  type ReferralPriority,
  type ReferralStatus,
  type ReferralTrackingRequest,
} from '@balswasthya/shared-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ChoiceGroup,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  StatusBadge,
} from '../../../src/components';
import { formatIndiaDate, formatIndiaDateTime } from '../../../src/features/children/labels';
import {
  EmergencyNotice,
  FacilityPicker,
  ReasonAction,
} from '../../../src/features/referrals/components/ReferralParts';
import {
  useFollowUpList,
  useReferral,
  useReferralMutation,
  useReferralPermissions,
  useReferralsApi,
} from '../../../src/features/referrals/hooks';
import { followUpStatusKey, indiaToday, referralStatusKey } from '../../../src/features/referrals/labels';
import { referralRoutes } from '../../../src/features/referrals/routes';
import { categoryTitleKey } from '../../../src/features/screening/labels';
import { useTranslation, type TranslationKey } from '../../../src/localization';
import { apiErrorMessageKey } from '../../../src/services/api/errorMessages';
import { isApiError } from '../../../src/services/api/errors';
import { newSubmissionId } from '../../../src/utils/submissionId';
import { spacing } from '../../../src/theme';

/** Tracking moves after issue (same table as the API; the API and database enforce it). */
const TRACKING_NEXT: Partial<Record<ReferralStatus, ReferralTrackingRequest['toStatus'][]>> = {
  ISSUED: ['ACKNOWLEDGED', 'APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED'],
  ACKNOWLEDGED: ['APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED'],
  APPOINTMENT_SCHEDULED: ['APPOINTMENT_SCHEDULED', 'VISITED', 'VISIT_NOT_COMPLETED'],
  VISIT_NOT_COMPLETED: ['APPOINTMENT_SCHEDULED', 'VISITED', 'FOLLOW_UP_REQUIRED'],
  VISITED: ['UNDER_TREATMENT', 'FOLLOW_UP_REQUIRED'],
  UNDER_TREATMENT: ['FOLLOW_UP_REQUIRED'],
  FOLLOW_UP_REQUIRED: ['APPOINTMENT_SCHEDULED', 'VISITED', 'UNDER_TREATMENT'],
};
const CLOSABLE: ReferralStatus[] = [
  'VISITED',
  'UNDER_TREATMENT',
  'FOLLOW_UP_REQUIRED',
  'VISIT_NOT_COMPLETED',
];
const BEFORE_ISSUE: (ReferralStatus | null)[] = [null, 'PENDING_APPROVAL', 'APPROVED'];

/**
 * One referral (Step 7F): status, facility, timeline and only the actions the API allows. Updates
 * from outside the app are labelled by source; family reports are shown as "not verified".
 */
export default function ReferralScreen() {
  const { t } = useTranslation();
  const { referralId = '' } = useLocalSearchParams<{ referralId: string }>();
  const referral = useReferral(referralId);

  if (referral.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="referral-detail">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (referral.isError) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="referral-detail">
        <ErrorState message={t(apiErrorMessageKey(referral.error))} onRetry={() => void referral.refetch()} />
      </ScreenContainer>
    );
  }
  return <ReferralView r={referral.data.referral} />;
}

function ReferralView({ r }: { r: ReferralDetail }) {
  const { t } = useTranslation();
  const permissions = useReferralPermissions();
  const api = useReferralsApi();
  const run = useReferralMutation((fn: () => Promise<unknown>) => fn());
  const canTrack = permissions.canApprove || permissions.canUpdate;
  const latest = r.history.at(-1);
  const correctable =
    canTrack &&
    latest !== undefined &&
    latest.correctsEventId === null &&
    !BEFORE_ISSUE.includes(latest.fromStatus) &&
    latest.toStatus === r.status &&
    !['REJECTED', 'CLOSED', 'CANCELLED'].includes(r.status);
  const error = run.error;
  const consentMissing = error && isApiError(error) && error.code === 'CONSENT_REQUIRED';

  return (
    <ScreenContainer edges={['left', 'right']} testID="referral-detail">
      <EmergencyNotice />
      <AppText variant="title">{r.childName}</AppText>
      <View style={styles.row}>
        <StatusBadge label={t(referralStatusKey(r.status))} tone="info" />
        <AppText variant="bodySmall" color="textSecondary" testID="referral-meta">
          {[
            r.category ? t(categoryTitleKey(r.category)) : null,
            t(`results.priority.${r.priority}` as TranslationKey),
            t(`referrals.origin.${r.origin}` as TranslationKey),
          ]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
      </View>
      {r.reasonNote ? <AppText variant="bodySmall">{r.reasonNote}</AppText> : null}
      {r.consentWithdrawnAfterIssue ? (
        <InlineAlert
          tone="warning"
          message={t('referrals.detail.consentWithdrawn')}
          testID="referral-consent-withdrawn"
        />
      ) : null}
      {error ? (
        <InlineAlert
          tone="danger"
          message={consentMissing ? t('referrals.detail.consentRequired') : t(apiErrorMessageKey(error))}
          testID="referral-error"
        />
      ) : null}

      {r.pendingReassessments > 0 ? (
        <AppCard style={styles.card} testID="referral-reassess">
          <AppText variant="bodyStrong">{t('referrals.detail.reassessTitle')}</AppText>
          <AppText variant="bodySmall">{t('referrals.detail.reassessText')}</AppText>
          {r.actions.reassess
            ? r.reassessments
                .filter((i) => i.reassessmentStatus === 'PENDING')
                .map((i) => (
                  <AppButton
                    key={i.id}
                    variant="secondary"
                    label={t('referrals.detail.reassessDone', { version: i.amendmentSequence + 1 })}
                    loading={run.isPending}
                    onPress={() => run.mutate(() => api.reassess(r.id, i.id))}
                    testID={`referral-reassess-${i.id}`}
                  />
                ))
            : null}
        </AppCard>
      ) : null}

      <SectionHeader title={t('referrals.facility.title')} />
      <AppText variant="body" testID="referral-facility">
        {r.facilityName ?? t('referrals.facility.notChosen')}
      </AppText>
      {r.issuedAt ? (
        <AppText variant="caption" color="textSecondary">
          {t('referrals.detail.issued', { date: formatIndiaDateTime(r.issuedAt) })}
        </AppText>
      ) : null}
      {r.appointmentAt ? (
        <AppText variant="bodySmall" testID="referral-appointment">
          {t('referrals.detail.appointment', { date: formatIndiaDateTime(r.appointmentAt) })}
        </AppText>
      ) : null}

      {r.actions.approve ? (
        <ApproveForm
          r={r}
          pending={run.isPending}
          onApprove={(p, f, why) =>
            run.mutate(() =>
              api.approve(r.id, {
                expectedVersion: r.version,
                priority: p,
                ...(f ? { facilityId: f } : {}),
                ...(why ? { outOfDistrictReason: why } : {}),
              }),
            )
          }
        />
      ) : null}
      {!r.actions.approve && r.actions.changeFacility ? (
        <FacilityChange
          r={r}
          canGoOutside={permissions.canApprove}
          pending={run.isPending}
          onSave={(f, why) => run.mutate(() => api.changeFacility(r.id, r.version, f, why || undefined))}
        />
      ) : null}

      <View style={styles.actions}>
        {r.actions.issue ? (
          <PrimaryButton
            icon="send-outline"
            label={t('referrals.detail.issue')}
            loading={run.isPending}
            onPress={() => run.mutate(() => api.issue(r.id, r.version))}
            testID="referral-issue"
          />
        ) : null}
        {r.actions.reject ? (
          <ReasonAction
            label={t('referrals.detail.reject')}
            reasonLabel={t('referrals.detail.rejectReason')}
            pending={run.isPending}
            onSubmit={(why) => run.mutate(() => api.reject(r.id, r.version, why))}
            testID="referral-reject"
          />
        ) : null}
        {canTrack && CLOSABLE.includes(r.status) ? (
          <ReasonAction
            label={t('referrals.detail.close')}
            reasonLabel={t('referrals.detail.closeReason')}
            pending={run.isPending}
            onSubmit={(why) => run.mutate(() => api.close(r.id, r.version, why))}
            testID="referral-close"
          />
        ) : null}
        {correctable && latest ? (
          <ReasonAction
            label={t('referrals.detail.correct')}
            reasonLabel={t('referrals.detail.correctReason')}
            pending={run.isPending}
            onSubmit={(why) => run.mutate(() => api.correct(r.id, r.version, latest.id, why))}
            testID="referral-correct"
          />
        ) : null}
        {r.actions.cancel ? (
          <ReasonAction
            label={t('referrals.detail.cancel')}
            reasonLabel={t('referrals.detail.cancelReason')}
            variant="danger"
            pending={run.isPending}
            onSubmit={(why) => run.mutate(() => api.cancel(r.id, r.version, why))}
            testID="referral-cancel"
          />
        ) : null}
      </View>

      {canTrack && TRACKING_NEXT[r.status] ? (
        <TrackingForm
          r={r}
          pending={run.isPending}
          onSubmit={(body) => run.mutate(() => api.track(r.id, body))}
        />
      ) : null}

      <SectionHeader title={t('referrals.detail.timeline')} />
      <View style={styles.list} testID="referral-timeline">
        {r.history.map((h) => (
          <AppCard key={h.id} style={styles.card}>
            <AppText variant="bodyStrong">
              {h.fromStatus === h.toStatus && h.facilityName
                ? t('referrals.detail.facilityAssigned', { name: h.facilityName })
                : t(referralStatusKey(h.toStatus))}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {t('referrals.detail.eventMeta', {
                date: formatIndiaDateTime(h.changedAt),
                name: h.changedByName,
              })}
            </AppText>
            {h.source !== 'APP_USER_DIRECT' && h.source !== 'SYSTEM' ? (
              <StatusBadge
                label={`${t(`referrals.source.${h.source}` as TranslationKey)} · ${t(h.verificationStatus === 'VERIFIED' ? 'referrals.verified' : 'referrals.notVerified')}`}
                tone={h.verificationStatus === 'VERIFIED' ? 'info' : 'warning'}
              />
            ) : null}
            {h.correctsEventId ? (
              <AppText variant="caption">{t('referrals.detail.correction')}</AppText>
            ) : null}
            {h.reason ? <AppText variant="bodySmall">{h.reason}</AppText> : null}
            {h.note ? <AppText variant="bodySmall">{h.note}</AppText> : null}
          </AppCard>
        ))}
      </View>

      <ReferralFollowUps r={r} />
    </ScreenContainer>
  );
}

function ApproveForm({
  r,
  pending,
  onApprove,
}: {
  r: ReferralDetail;
  pending: boolean;
  onApprove: (p: ReferralPriority, facilityId: string, why: string) => void;
}) {
  const { t } = useTranslation();
  const [priority, setPriority] = useState<ReferralPriority>(r.priority);
  const [facilityId, setFacilityId] = useState(r.facilityId ?? '');
  const [why, setWhy] = useState('');
  return (
    <AppCard style={styles.card} testID="referral-approve-form">
      <SectionHeader title={t('referrals.detail.approveTitle')} />
      <ChoiceGroup<ReferralPriority>
        label={t('referrals.new.priority')}
        hint={t('reviews.form.priorityHint')}
        options={REFERRAL_PRIORITIES.map((p) => ({
          value: p,
          label: t(`results.priority.${p}` as TranslationKey),
        }))}
        value={priority}
        onChange={setPriority}
        testID="referral-approve-priority"
      />
      <FacilityPicker
        childId={r.childId}
        value={facilityId}
        onChange={(f) => setFacilityId(f.id)}
        allowOutOfDistrict
        outOfDistrictReason={why}
        onOutOfDistrictReason={setWhy}
      />
      <PrimaryButton
        label={t('referrals.detail.approve')}
        loading={pending}
        onPress={() => onApprove(priority, facilityId, why.trim())}
        testID="referral-approve"
      />
    </AppCard>
  );
}

function FacilityChange({
  r,
  canGoOutside,
  pending,
  onSave,
}: {
  r: ReferralDetail;
  canGoOutside: boolean;
  pending: boolean;
  onSave: (facilityId: string, why: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [facilityId, setFacilityId] = useState(r.facilityId ?? '');
  const [why, setWhy] = useState('');
  if (!open) {
    return (
      <AppButton
        variant="secondary"
        label={t('referrals.facility.change')}
        onPress={() => setOpen(true)}
        testID="referral-facility-change"
      />
    );
  }
  return (
    <AppCard style={styles.card}>
      <FacilityPicker
        childId={r.childId}
        value={facilityId}
        onChange={(f) => setFacilityId(f.id)}
        allowOutOfDistrict={canGoOutside}
        outOfDistrictReason={why}
        onOutOfDistrictReason={setWhy}
      />
      <PrimaryButton
        label={t('referrals.facility.save')}
        loading={pending}
        disabled={!facilityId}
        onPress={() => onSave(facilityId, why.trim())}
        testID="referral-facility-save"
      />
    </AppCard>
  );
}

function TrackingForm({
  r,
  pending,
  onSubmit,
}: {
  r: ReferralDetail;
  pending: boolean;
  onSubmit: (b: ReferralTrackingRequest) => void;
}) {
  const { t } = useTranslation();
  const [toStatus, setToStatus] = useState<ReferralTrackingRequest['toStatus'] | ''>('');
  const [source, setSource] = useState<ReferralTrackingRequest['source'] | ''>('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const appointment = toStatus === 'APPOINTMENT_SCHEDULED';
  const submit = () => {
    if (!toStatus || !source) return setError(t('referrals.tracking.required'));
    if (appointment && (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !/^\d{2}:\d{2}$/.test(time.trim()))) {
      return setError(t('referrals.tracking.appointmentRequired'));
    }
    setError(null);
    onSubmit({
      expectedVersion: r.version,
      toStatus,
      source,
      ...(appointment ? { appointmentAt: `${date.trim()}T${time.trim()}:00+05:30` } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };
  return (
    <AppCard style={styles.card} testID="referral-tracking">
      <SectionHeader title={t('referrals.tracking.title')} subtitle={t('referrals.tracking.subtitle')} />
      <ChoiceGroup<ReferralTrackingRequest['toStatus']>
        label={t('referrals.tracking.what')}
        options={(TRACKING_NEXT[r.status] ?? []).map((s) => ({ value: s, label: t(referralStatusKey(s)) }))}
        value={toStatus}
        onChange={setToStatus}
        testID="referral-tracking-status"
      />
      <ChoiceGroup<ReferralTrackingRequest['source']>
        label={t('referrals.tracking.source')}
        options={TRACKING_SOURCES.map((s) => ({
          value: s,
          label: t(`referrals.source.${s}` as TranslationKey),
        }))}
        value={source}
        onChange={setSource}
        testID="referral-tracking-source"
      />
      {appointment ? (
        <View style={styles.row}>
          <AppInput
            label={t('referrals.tracking.date')}
            hint="YYYY-MM-DD"
            value={date}
            onChangeText={setDate}
            testID="referral-tracking-date"
          />
          <AppInput
            label={t('referrals.tracking.time')}
            hint="HH:MM"
            value={time}
            onChangeText={setTime}
            testID="referral-tracking-time"
          />
        </View>
      ) : null}
      <AppInput
        label={t('referrals.tracking.note')}
        hint={t('referrals.reasonHint')}
        value={note}
        onChangeText={setNote}
        maxLength={1000}
        multiline
        testID="referral-tracking-note"
      />
      {error ? <InlineAlert tone="danger" message={error} testID="referral-tracking-error" /> : null}
      <PrimaryButton
        label={t('referrals.tracking.save')}
        loading={pending}
        onPress={submit}
        testID="referral-tracking-save"
      />
    </AppCard>
  );
}

/** Follow-ups of this referral and, for referral workers, creating one. */
function ReferralFollowUps({ r }: { r: ReferralDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useReferralPermissions();
  const api = useReferralsApi();
  const list = useFollowUpList('all', r.id);
  const [reason, setReason] = useState<(typeof FOLLOW_UP_REASON_CODES)[number] | ''>('');
  const [due, setDue] = useState('');
  const [op] = useState(newSubmissionId);
  const create = useReferralMutation(() =>
    api.createFollowUp({
      clientOperationId: op,
      childId: r.childId,
      referralId: r.id,
      reasonCode: reason as never,
      dueDate: due.trim(),
    }),
  );
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const open = !['REJECTED', 'CLOSED', 'CANCELLED'].includes(r.status);
  return (
    <View style={styles.list} testID="referral-follow-ups">
      <SectionHeader title={t('followUps.title')} />
      {items.length === 0 ? <AppText color="textSecondary">{t('followUps.none')}</AppText> : null}
      {items.map((f) => (
        <Pressable
          key={f.id}
          accessibilityRole="button"
          onPress={() => router.push(referralRoutes.followUp(f.id))}
          testID={`referral-follow-up-${f.id}`}
        >
          <AppCard style={styles.card}>
            <AppText variant="bodyStrong">{t(`followUps.reason.${f.reasonCode}` as TranslationKey)}</AppText>
            <AppText variant="caption" color="textSecondary">
              {t('followUps.dueLine', {
                date: formatIndiaDate(`${f.dueDate}T00:00:00+05:30`),
                status: t(followUpStatusKey(f.status)),
              })}
            </AppText>
          </AppCard>
        </Pressable>
      ))}
      {open && (permissions.canCreate || permissions.canUpdate) ? (
        <AppCard style={styles.card} testID="referral-follow-up-new">
          <ChoiceGroup<(typeof FOLLOW_UP_REASON_CODES)[number]>
            label={t('followUps.new.reason')}
            options={FOLLOW_UP_REASON_CODES.filter((c) => c !== 'ADDITIONAL_SCREENING').map((c) => ({
              value: c,
              label: t(`followUps.reason.${c}` as TranslationKey),
            }))}
            value={reason}
            onChange={setReason}
            testID="referral-follow-up-reason"
          />
          <AppInput
            label={t('followUps.new.dueDate')}
            hint={t('followUps.new.dueHint', { today: indiaToday() })}
            value={due}
            onChangeText={setDue}
            testID="referral-follow-up-due"
          />
          {create.error ? (
            <InlineAlert
              tone="danger"
              message={t(apiErrorMessageKey(create.error))}
              testID="referral-follow-up-error"
            />
          ) : null}
          <AppButton
            variant="secondary"
            label={t('followUps.new.save')}
            loading={create.isPending}
            disabled={!reason || !due.trim()}
            onPress={() => create.mutate(undefined)}
            testID="referral-follow-up-save"
          />
        </AppCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  actions: { gap: spacing.sm },
  list: { gap: spacing.sm },
  card: { gap: spacing.sm },
});
