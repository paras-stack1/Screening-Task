import type { FacilityOption } from '@balswasthya/shared-contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ChoiceGroup,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  StatusBadge,
  type ButtonVariant,
} from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { apiErrorMessageKey } from '../../../services/api/errorMessages';
import { spacing } from '../../../theme';
import { useFacilityOptions } from '../hooks';

/** Fixed notice on referral screens: the app never stands between a child and emergency care. */
export function EmergencyNotice() {
  const { t } = useTranslation();
  return <InlineAlert tone="warning" message={t('reviews.emergency')} testID="referral-emergency" />;
}

/**
 * An action that needs a short reason (reject, cancel, close, miss, correct...). The reason is
 * required by the API as well; it is sent once and the screen reloads afterwards.
 */
export function ReasonAction({
  label,
  reasonLabel,
  variant = 'secondary',
  pending,
  onSubmit,
  testID,
}: {
  label: string;
  reasonLabel: string;
  variant?: ButtonVariant;
  pending: boolean;
  onSubmit: (reason: string) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  if (!open) {
    return <AppButton variant={variant} label={label} onPress={() => setOpen(true)} testID={testID} />;
  }
  return (
    <AppCard style={styles.card} testID={`${testID}-form`}>
      <AppInput
        label={reasonLabel}
        hint={t('referrals.reasonHint')}
        value={reason}
        onChangeText={setReason}
        maxLength={1000}
        multiline
        error={error ? t('referrals.reasonRequired') : undefined}
        testID={`${testID}-reason`}
      />
      <View style={styles.row}>
        <AppButton
          variant="primary"
          label={label}
          loading={pending}
          onPress={() => {
            if (reason.trim().length < 3) return setError(true);
            setError(false);
            onSubmit(reason.trim());
          }}
          testID={`${testID}-confirm`}
        />
        <AppButton
          variant="secondary"
          label={t('common.cancel')}
          onPress={() => setOpen(false)}
          testID={`${testID}-back`}
        />
      </View>
    </AppCard>
  );
}

/**
 * Facility choice for a referral (decision P). Shows only what the API returns: in-district
 * facilities first; ones that are inactive, unverified or not accepting referrals are listed but
 * cannot be chosen. Approvers may show out-of-district facilities (a reason is then required).
 * The nearest facility is never pre-selected.
 */
export function FacilityPicker({
  childId,
  value,
  onChange,
  allowOutOfDistrict,
  outOfDistrictReason,
  onOutOfDistrictReason,
}: {
  childId: string;
  value: string;
  onChange: (facility: FacilityOption) => void;
  allowOutOfDistrict: boolean;
  outOfDistrictReason: string;
  onOutOfDistrictReason: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [showOther, setShowOther] = useState(false);
  const facilities = useFacilityOptions(childId, showOther);
  if (facilities.isPending) return <LoadingIndicator label={t('common.loading')} />;
  if (facilities.isError) {
    return (
      <ErrorState
        message={t(apiErrorMessageKey(facilities.error))}
        onRetry={() => void facilities.refetch()}
      />
    );
  }
  const items = facilities.data.items;
  const selectable = items.filter((f) => f.selectable);
  const chosen = items.find((f) => f.id === value);
  return (
    <View style={styles.stack} testID="facility-picker">
      {selectable.length === 0 ? (
        <AppText color="textSecondary" testID="facility-none">
          {t('referrals.facility.none')}
        </AppText>
      ) : (
        <ChoiceGroup<string>
          label={t('referrals.facility.choose')}
          options={selectable.map((f) => ({
            value: f.id,
            label: `${f.name}${f.placement === 'OUT_OF_DISTRICT' ? ` (${t('referrals.facility.outOfDistrict')})` : ''}`,
          }))}
          value={value}
          onChange={(id) => onChange(selectable.find((f) => f.id === id)!)}
          testID="facility-choice"
        />
      )}
      {items.length > selectable.length ? (
        <AppText variant="caption" color="textSecondary">
          {t('referrals.facility.notSelectable', { count: items.length - selectable.length })}
        </AppText>
      ) : null}
      {chosen ? <FacilityDetails facility={chosen} /> : null}
      {allowOutOfDistrict && !showOther ? (
        <AppButton
          variant="secondary"
          label={t('referrals.facility.showOther')}
          onPress={() => setShowOther(true)}
          testID="facility-show-other"
        />
      ) : null}
      {chosen?.placement === 'OUT_OF_DISTRICT' ? (
        <AppInput
          label={t('referrals.facility.outOfDistrictReason')}
          value={outOfDistrictReason}
          onChangeText={onOutOfDistrictReason}
          maxLength={1000}
          testID="facility-out-of-district-reason"
        />
      ) : null}
    </View>
  );
}

/** Facility details: only verified information from the directory - no capacity, no ranking. */
export function FacilityDetails({ facility }: { facility: FacilityOption }) {
  const { t } = useTranslation();
  return (
    <AppCard style={styles.card} testID="facility-details">
      <AppText variant="bodyStrong">{facility.name}</AppText>
      <AppText variant="caption" color="textSecondary">
        {t(`referrals.facilityType.${facility.type}` as TranslationKey)} · {facility.areaPath.join(' / ')}
      </AppText>
      {facility.address ? <AppText variant="bodySmall">{facility.address}</AppText> : null}
      {facility.contactPhone ? (
        <AppText variant="bodySmall">
          {t('referrals.facility.phone', { phone: facility.contactPhone })}
        </AppText>
      ) : null}
      {facility.services.length > 0 ? (
        <AppText variant="bodySmall">
          {t('referrals.facility.services', { services: facility.services.join(', ') })}
        </AppText>
      ) : null}
      <StatusBadge
        label={t(
          facility.verificationStatus === 'VERIFIED'
            ? 'referrals.facility.verified'
            : 'referrals.facility.unverified',
        )}
        tone={facility.verificationStatus === 'VERIFIED' ? 'info' : 'warning'}
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
