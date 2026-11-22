import {
  CONSENT_METHODS,
  type ChildDetail,
  type ConsentMethod,
  type ConsentRecord,
} from '@balswasthya/shared-contracts';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ChoiceGroup,
  ConfirmationDialog,
  InlineAlert,
} from '../../components';
import { useTranslation, type TranslationKey } from '../../localization';
import { apiErrorMessageKey } from '../../services/api/errorMessages';
import { isApiError } from '../../services/api/errors';
import { spacing } from '../../theme';
import { useChildrenApi, useInvalidateChildData } from '../children/hooks';
import { formatIndiaDate, relationshipLabel } from '../children/labels';
import { methodLabel, purposeLabel } from './ConsentStatusBadge';

const ERRORS: Record<string, TranslationKey> = {
  ALREADY_WITHDRAWN: 'consent.withdraw.errors.alreadyWithdrawn',
  NOT_CURRENT_CONSENT: 'consent.withdraw.errors.notCurrent',
  NOT_WITHDRAWABLE: 'consent.withdraw.errors.notCurrent',
  GUARDIAN_NOT_AUTHORISED: 'consent.record.errors.guardian',
  GUARDIAN_NOT_LINKED: 'consent.record.errors.guardian',
};

/**
 * Records a withdrawal of one purpose. The original grant stays in the history; other purposes
 * are not affected. Any currently linked guardian with consent authority may withdraw (decision N).
 */
export function WithdrawConsentForm({ child, record }: { child: ChildDetail; record: ConsentRecord }) {
  const { t } = useTranslation();
  const router = useRouter();
  const api = useChildrenApi();
  const invalidate = useInvalidateChildData();
  const eligible = child.guardians.filter((g) => g.canGiveConsent);
  const [guardianId, setGuardianId] = useState('');
  const [method, setMethod] = useState<ConsentMethod | ''>('');
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const send = () => {
    if (inFlight.current || !guardianId || !method) return;
    inFlight.current = true;
    setSaving(true);
    setServerError(null);
    api
      .withdrawConsent(child.id, record.id, {
        guardianId,
        method,
        ...(reason.trim() && { reason: reason.trim() }),
      })
      .then(async () => {
        await invalidate();
        setConfirming(false);
        router.back();
      })
      .catch((error: unknown) => {
        setConfirming(false);
        const code = isApiError(error) ? error.code : undefined;
        setServerError(code && ERRORS[code] ? ERRORS[code] : apiErrorMessageKey(error));
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };

  return (
    <View style={styles.stack} testID="withdraw-form">
      <AppCard>
        <AppText variant="subtitle">{purposeLabel(t, record.purpose)}</AppText>
        <AppText>
          {t('consent.withdraw.grantedLine', {
            name: record.guardianName,
            date: formatIndiaDate(record.recordedAt),
          })}
        </AppText>
      </AppCard>
      <AppText variant="bodySmall" color="textSecondary">
        {t('consent.withdraw.explain')}
      </AppText>
      {eligible.length === 0 ? (
        <InlineAlert tone="warning" message={t('consent.record.noEligibleGuardian')} />
      ) : (
        <ChoiceGroup
          label={`${t('consent.withdraw.guardianQuestion')} *`}
          options={eligible.map((g) => ({
            value: g.guardianId,
            label: `${g.fullName} (${relationshipLabel(t, g.relationship)})`,
          }))}
          value={guardianId}
          onChange={setGuardianId}
          error={missing && !guardianId ? t('consent.record.errors.guardianRequired') : undefined}
          testID="withdraw-guardian"
        />
      )}
      <ChoiceGroup
        label={`${t('consent.withdraw.methodQuestion')} *`}
        options={CONSENT_METHODS.map((value) => ({ value, label: methodLabel(t, value) }))}
        value={method}
        onChange={setMethod}
        error={missing && !method ? t('consent.record.errors.methodRequired') : undefined}
        testID="withdraw-method"
      />
      <AppInput
        label={t('consent.withdraw.reason')}
        hint={t('children.link.reasonHint')}
        value={reason}
        onChangeText={setReason}
        maxLength={200}
        testID="withdraw-reason"
      />
      {serverError ? <InlineAlert message={t(serverError)} testID="withdraw-error" /> : null}
      <AppButton
        variant="danger"
        icon="undo-variant"
        label={t('consent.withdraw.save')}
        loading={saving}
        disabled={eligible.length === 0}
        onPress={() => {
          if (!guardianId || !method) setMissing(true);
          else setConfirming(true);
        }}
        testID="withdraw-save"
      />
      <ConfirmationDialog
        visible={confirming}
        title={t('consent.withdraw.confirmTitle', { purpose: purposeLabel(t, record.purpose) })}
        message={t('consent.withdraw.confirmMessage')}
        confirmLabel={t('consent.withdraw.save')}
        destructive
        confirming={saving}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({ stack: { gap: spacing.md } });
