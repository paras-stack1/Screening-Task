import {
  CONSENT_METHODS,
  CONSENT_PURPOSES,
  type ChildDetail,
  type ConsentMethod,
  type ConsentPurpose,
  type ConsentRecordResponse,
} from '@balswasthya/shared-contracts';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppIcon,
  AppInput,
  AppText,
  ChoiceGroup,
  ConfirmationDialog,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  SectionHeader,
} from '../../components';
import { useTranslation, type TranslationKey } from '../../localization';
import { apiErrorMessageKey } from '../../services/api/errorMessages';
import { isApiError } from '../../services/api/errors';
import { colors, radius, spacing, touchTarget } from '../../theme';
import { newSubmissionId } from '../../utils/submissionId';
import { useChildrenApi, useConsentNotices, useInvalidateChildData } from '../children/hooks';
import { relationshipLabel } from '../children/labels';
import { ConsentStatusBadge, decisionLabel, methodLabel, purposeLabel } from './ConsentStatusBadge';

const ERRORS: Record<string, TranslationKey> = {
  NOTICE_OUTDATED: 'consent.record.errors.outdated',
  NOTICE_NOT_APPROVED: 'consent.record.errors.notApproved',
  NOTICE_MISMATCH: 'consent.record.errors.outdated',
  GUARDIAN_NOT_AUTHORISED: 'consent.record.errors.guardian',
  GUARDIAN_NOT_LINKED: 'consent.record.errors.guardian',
  CONSENT_NOTICE_UNAVAILABLE: 'consent.record.errors.noticeUnavailable',
};

type Field = 'guardian' | 'purpose' | 'explained' | 'decision' | 'method';

/**
 * Guided capture of ONE decision for ONE purpose by ONE guardian (docs/frontend/consent.md).
 * Nothing is preselected; the exact notice shown is sent with the decision (templateId); the API
 * records the time and the worker. The app never claims the consent is legally verified.
 */
export function RecordConsentForm({ child }: { child: ChildDetail }) {
  const { t, language: uiLanguage } = useTranslation();
  const router = useRouter();
  const api = useChildrenApi();
  const invalidate = useInvalidateChildData();

  const eligible = child.guardians.filter((g) => g.canGiveConsent);
  const [guardianId, setGuardianId] = useState('');
  const guardian = eligible.find((g) => g.guardianId === guardianId);
  const [language, setLanguage] = useState<'hi' | 'en'>(uiLanguage === 'en' ? 'en' : 'hi');
  const [purpose, setPurpose] = useState<ConsentPurpose | ''>('');
  const [explained, setExplained] = useState(false);
  const [decision, setDecision] = useState<'GRANTED' | 'REFUSED' | ''>('');
  const [method, setMethod] = useState<ConsentMethod | ''>('');
  const [evidence, setEvidence] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, true>>>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [result, setResult] = useState<ConsentRecordResponse | null>(null);
  const inFlight = useRef(false);
  const submission = useRef<{ id: string; key: string } | null>(null);

  // Fetched only once a purpose is chosen, so the guardian's language is already applied.
  const notices = useConsentNotices(language, eligible.length > 0 && Boolean(purpose));
  const notice = notices.data?.find((n) => n.purpose === purpose);

  const resetDecision = () => {
    setExplained(false);
    setDecision('');
    setMethod('');
    setServerError(null);
  };

  if (eligible.length === 0) {
    return (
      <View style={styles.stack}>
        <InlineAlert
          tone="warning"
          message={t('consent.record.noEligibleGuardian')}
          testID="consent-no-guardian"
        />
        <AppButton
          variant="secondary"
          label={t('consent.record.backToProfile')}
          onPress={() => router.back()}
        />
      </View>
    );
  }

  if (result) {
    return (
      <View style={styles.stack} testID="consent-recorded">
        <InlineAlert tone="info" message={t('consent.record.saved')} />
        <AppCard>
          <AppText variant="bodyStrong">{purposeLabel(t, result.consent.purpose)}</AppText>
          <AppText>
            {t('consent.record.savedLine', {
              guardian: result.consent.guardianName,
              decision: decisionLabel(t, result.consent.decision),
            })}
          </AppText>
          <ConsentStatusBadge status={result.status} />
        </AppCard>
        <PrimaryButton
          label={t('consent.record.another')}
          onPress={() => {
            setResult(null);
            setPurpose('');
            resetDecision();
            setEvidence('');
            submission.current = null;
          }}
          testID="consent-record-another"
        />
        <AppButton
          variant="secondary"
          label={t('consent.record.backToProfile')}
          onPress={() => router.back()}
          testID="consent-back"
        />
      </View>
    );
  }

  const validate = () => {
    const next: Partial<Record<Field, true>> = {};
    if (!guardian) next.guardian = true;
    if (!purpose) next.purpose = true;
    if (!explained) next.explained = true;
    if (!decision) next.decision = true;
    if (!method) next.method = true;
    setErrors(next);
    return Object.keys(next).length === 0 && Boolean(notice);
  };

  const send = () => {
    if (inFlight.current || !notice || !guardian || !purpose || !decision || !method) return;
    inFlight.current = true;
    setSaving(true);
    setServerError(null);
    const content = {
      guardianId: guardian.guardianId,
      purpose,
      decision,
      method,
      templateId: notice.templateId,
      ...(evidence.trim() && { evidenceReference: evidence.trim() }),
    };
    const key = JSON.stringify(content);
    if (submission.current?.key !== key) submission.current = { id: newSubmissionId(), key };
    api
      .recordConsent(child.id, { ...content, clientOperationId: submission.current.id })
      .then(async (response) => {
        await invalidate();
        setConfirming(false);
        setResult(response);
      })
      .catch((error: unknown) => {
        setConfirming(false);
        const code = isApiError(error) ? error.code : undefined;
        if (code && ERRORS[code]) {
          setServerError(ERRORS[code]);
          if (code === 'NOTICE_OUTDATED' || code === 'NOTICE_MISMATCH') {
            setExplained(false); // the new wording must be explained again
            void notices.refetch();
          }
        } else if (isApiError(error) && error.status === 404) setServerError('children.profile.notFound');
        else setServerError(apiErrorMessageKey(error));
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };

  return (
    <View style={styles.stack} testID="consent-form">
      <AppText variant="bodySmall" color="textSecondary">
        {t('consent.record.intro')}
      </AppText>

      <SectionHeader title={t('consent.record.step1')} />
      <ChoiceGroup
        label={`${t('consent.record.guardianQuestion')} *`}
        hint={t('consent.record.guardianHint')}
        options={eligible.map((g) => ({
          value: g.guardianId,
          label: `${g.fullName} (${relationshipLabel(t, g.relationship)})`,
        }))}
        value={guardianId}
        onChange={(value) => {
          setGuardianId(value);
          const chosen = eligible.find((g) => g.guardianId === value);
          if (chosen?.preferredLanguage === 'en' || chosen?.preferredLanguage === 'hi') {
            setLanguage(chosen.preferredLanguage);
          }
          resetDecision();
        }}
        error={errors.guardian ? t('consent.record.errors.guardianRequired') : undefined}
        testID="consent-guardian"
      />

      <SectionHeader title={t('consent.record.step2')} subtitle={t('consent.record.step2Hint')} />
      <ChoiceGroup
        label={`${t('consent.record.purposeQuestion')} *`}
        options={CONSENT_PURPOSES.map((value) => ({ value, label: purposeLabel(t, value) }))}
        value={purpose}
        onChange={(value) => {
          setPurpose(value);
          resetDecision();
        }}
        error={errors.purpose ? t('consent.record.errors.purposeRequired') : undefined}
        testID="consent-purpose"
      />
      <ChoiceGroup
        label={t('consent.record.noticeLanguage')}
        options={[
          { value: 'hi', label: 'हिंदी' },
          { value: 'en', label: 'English' },
        ]}
        value={language}
        onChange={(value) => {
          setLanguage(value);
          setExplained(false);
        }}
        testID="consent-language"
      />

      {purpose ? (
        notices.isPending ? (
          <LoadingIndicator label={t('common.loading')} />
        ) : !notice ? (
          <InlineAlert
            tone="warning"
            message={t('consent.record.noticeMissing')}
            testID="consent-notice-missing"
          />
        ) : (
          <AppCard testID="consent-notice">
            {notice.isPlaceholder ? (
              <InlineAlert
                tone="warning"
                message={t('consent.record.placeholder')}
                testID="consent-placeholder"
              />
            ) : null}
            <AppText variant="subtitle" accessibilityRole="header">
              {notice.title}
            </AppText>
            <AppText>{notice.body}</AppText>
            <AppText variant="caption" color="textSecondary">
              {t('consent.record.noticeVersion', { version: notice.version, language: notice.language })}
            </AppText>
            <AppText variant="bodySmall" color={notice.optional ? 'textSecondary' : 'textPrimary'}>
              {notice.optional ? t('consent.record.optional') : t('consent.record.participation')}
            </AppText>
          </AppCard>
        )
      ) : null}

      <SectionHeader title={t('consent.record.step3')} />
      <Checkbox
        checked={explained}
        onChange={setExplained}
        label={t('consent.record.explained')}
        error={errors.explained ? t('consent.record.errors.explainedRequired') : undefined}
      />
      <ChoiceGroup
        label={`${t('consent.record.decisionQuestion')} *`}
        options={[
          { value: 'GRANTED', label: t('consent.record.decisionGranted') },
          { value: 'REFUSED', label: t('consent.record.decisionRefused') },
        ]}
        value={decision}
        onChange={setDecision}
        error={errors.decision ? t('consent.record.errors.decisionRequired') : undefined}
        testID="consent-decision"
      />
      <ChoiceGroup
        label={`${t('consent.record.methodQuestion')} *`}
        hint={t('consent.record.methodHint')}
        options={CONSENT_METHODS.map((value) => ({ value, label: methodLabel(t, value) }))}
        value={method}
        onChange={setMethod}
        error={errors.method ? t('consent.record.errors.methodRequired') : undefined}
        testID="consent-method"
      />
      <AppInput
        label={t('consent.record.evidence')}
        hint={t('consent.record.evidenceHint')}
        value={evidence}
        onChangeText={setEvidence}
        maxLength={64}
        autoCapitalize="characters"
        autoComplete="off"
        testID="consent-evidence"
      />

      {serverError ? <InlineAlert message={t(serverError)} testID="consent-error" /> : null}
      <PrimaryButton
        label={t('consent.record.save')}
        onPress={() => {
          if (validate()) setConfirming(true);
        }}
        loading={saving}
        testID="consent-save"
      />

      <ConfirmationDialog
        visible={confirming}
        title={t('consent.record.confirmTitle')}
        message={
          guardian && purpose && decision
            ? t('consent.record.confirmMessage', {
                guardian: guardian.fullName,
                purpose: purposeLabel(t, purpose),
                decision: decisionLabel(t, decision),
              })
            : undefined
        }
        confirmLabel={t('consent.record.confirm')}
        confirming={saving}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

/** Unchecked by default; the worker confirms the notice was explained. */
function Checkbox({
  checked,
  onChange,
  label,
  error,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  error?: string;
}) {
  return (
    <View style={styles.checkboxBlock}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        style={({ pressed }) => [styles.checkbox, checked && styles.checked, pressed && styles.pressed]}
        testID="consent-explained"
      >
        <AppIcon
          name={checked ? 'checkbox-marked-outline' : 'checkbox-blank-outline'}
          color={checked ? colors.primary : colors.textSecondary}
        />
        <AppText style={styles.checkboxText}>{label}</AppText>
      </Pressable>
      {error ? (
        <AppText
          variant="bodySmall"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  checkboxBlock: { gap: spacing.xs },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.min,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  checked: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  pressed: { backgroundColor: colors.surfaceMuted },
  checkboxText: { flex: 1 },
});
