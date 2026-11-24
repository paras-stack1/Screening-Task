import {
  REFERRAL_PRIORITIES,
  type CreateReferralRequest,
  type FourDCategoryCode,
  type ReferralPriority,
} from '@balswasthya/shared-contracts';
import { newSubmissionId } from '../../../src/utils/submissionId';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppInput,
  AppText,
  ChoiceGroup,
  EmptyState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
} from '../../../src/components';
import { EmergencyNotice, FacilityPicker } from '../../../src/features/referrals/components/ReferralParts';
import {
  useReferralMutation,
  useReferralPermissions,
  useReferralsApi,
} from '../../../src/features/referrals/hooks';
import { referralRoutes } from '../../../src/features/referrals/routes';
import { categoryTitleKey } from '../../../src/features/screening/labels';
import { useTranslation, type TranslationKey } from '../../../src/localization';
import { apiErrorMessageKey } from '../../../src/services/api/errorMessages';
import { isApiError } from '../../../src/services/api/errors';
import { spacing } from '../../../src/theme';

type Reason = CreateReferralRequest['reasonCode'];
const REASONS: Reason[] = [
  'RULE_RECOMMENDATION',
  'WORKER_OBSERVED_CONCERN',
  'GUARDIAN_REPORTED_CONCERN',
  'OTHER',
];

/**
 * New referral (Step 7 decision K). A worker's referral always waits for a medical officer's
 * approval; the priority chosen here is only a suggestion. "Screening rules recommend it" is
 * offered only when the current screening result says so (the API checks again). The facility is
 * optional now and required before the referral is issued. Retries are safe (one operation id
 * per form), and a second active referral for the same purpose is refused with a link to it.
 */
export default function NewReferralScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{
    childId?: string;
    sessionId?: string;
    category?: FourDCategoryCode;
    recommended?: string;
  }>();
  const childId = params.childId ?? '';
  const permissions = useReferralPermissions();
  const api = useReferralsApi();
  const operationId = useRef(newSubmissionId());
  const [reason, setReason] = useState<Reason | ''>(params.recommended === '1' ? 'RULE_RECOMMENDATION' : '');
  const [priority, setPriority] = useState<ReferralPriority | ''>('');
  const [note, setNote] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const create = useReferralMutation((body: CreateReferralRequest) => api.create(body));

  if (!permissions.loaded) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="referral-new">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (!permissions.canCreate || !childId) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="referral-new">
        <EmptyState icon="lock-outline" title={t('referrals.notForRole')} />
      </ScreenContainer>
    );
  }
  const reasons = REASONS.filter((r) => r !== 'RULE_RECOMMENDATION' || params.recommended === '1');
  const duplicate =
    create.error && isApiError(create.error) && create.error.code === 'REFERRAL_ALREADY_ACTIVE'
      ? (create.error.details as { referralId?: string } | undefined)?.referralId
      : undefined;

  const submit = () => {
    if (!reason || !priority) return setFormError(t('referrals.new.required'));
    if (reason === 'OTHER' && note.trim().length < 3) return setFormError(t('referrals.new.noteRequired'));
    setFormError(null);
    create.mutate(
      {
        clientOperationId: operationId.current,
        childId,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.category ? { category: params.category } : {}),
        suggestedPriority: priority,
        reasonCode: reason,
        ...(note.trim() ? { reasonNote: note.trim() } : {}),
        ...(facilityId ? { facilityId } : {}),
      },
      { onSuccess: (res) => router.replace(referralRoutes.referral(res.referral.id)) },
    );
  };

  return (
    <ScreenContainer edges={['left', 'right']} testID="referral-new">
      <EmergencyNotice />
      <AppText variant="body">{t('referrals.new.intro')}</AppText>
      {params.category ? (
        <AppText variant="bodyStrong" testID="referral-new-category">
          {t('referrals.new.category', { category: t(categoryTitleKey(params.category)) })}
        </AppText>
      ) : null}
      <ChoiceGroup<Reason>
        label={t('referrals.new.reason')}
        options={reasons.map((r) => ({ value: r, label: t(`referrals.reason.${r}` as TranslationKey) }))}
        value={reason}
        onChange={setReason}
        testID="referral-new-reason"
      />
      <ChoiceGroup<ReferralPriority>
        label={t('referrals.new.priority')}
        hint={t('referrals.new.priorityHint')}
        options={REFERRAL_PRIORITIES.map((p) => ({
          value: p,
          label: t(`results.priority.${p}` as TranslationKey),
        }))}
        value={priority}
        onChange={setPriority}
        testID="referral-new-priority"
      />
      <AppInput
        label={reason === 'OTHER' ? t('referrals.new.noteRequiredLabel') : t('referrals.new.note')}
        hint={t('referrals.reasonHint')}
        value={note}
        onChangeText={setNote}
        maxLength={1000}
        multiline
        testID="referral-new-note"
      />
      <View style={styles.section}>
        <SectionHeader title={t('referrals.facility.title')} subtitle={t('referrals.facility.optionalNow')} />
        <FacilityPicker
          childId={childId}
          value={facilityId}
          onChange={(f) => setFacilityId(f.id)}
          allowOutOfDistrict={false}
          outOfDistrictReason=""
          onOutOfDistrictReason={() => undefined}
        />
      </View>
      {formError ? <InlineAlert tone="danger" message={formError} testID="referral-new-form-error" /> : null}
      {create.error ? (
        <InlineAlert
          tone="danger"
          message={duplicate ? t('referrals.new.duplicate') : t(apiErrorMessageKey(create.error))}
          testID="referral-new-error"
        />
      ) : null}
      {duplicate ? (
        <PrimaryButton
          label={t('referrals.new.openExisting')}
          onPress={() => router.replace(referralRoutes.referral(duplicate))}
          testID="referral-new-open-existing"
        />
      ) : (
        <PrimaryButton
          icon="send-outline"
          label={t('referrals.new.save')}
          loading={create.isPending}
          onPress={submit}
          testID="referral-new-save"
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({ section: { gap: spacing.sm } });
