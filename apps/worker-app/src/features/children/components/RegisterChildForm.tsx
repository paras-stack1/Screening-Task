import {
  duplicateChildDetailsSchema,
  duplicateGuardianDetailsSchema,
  normalizeIndianMobile,
  type ChildDetail,
  type DuplicateChildDetails,
  type DuplicateGuardianDetails,
} from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppText,
  ChoiceGroup,
  ConfirmationDialog,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  SectionHeader,
  StatusBadge,
} from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { apiErrorMessageKey } from '../../../services/api/errorMessages';
import { isApiError } from '../../../services/api/errors';
import { spacing } from '../../../theme';
import { newSubmissionId } from '../../../utils/submissionId';
import { validationMessageKey } from '../../auth/authErrors';
import { useChild, useChildrenApi, useInvalidateChildData, useRegistrationAreas } from '../hooks';
import { areaLabel, birthText, relationshipLabel, sexLabel } from '../labels';
import { childRoutes } from '../routes';
import {
  birthPayload,
  createRegistrationSchema,
  emptyRegistration,
  toRegisterRequest,
  type DuplicateConfirmations,
  type RegistrationFormValues,
} from '../validation';
import { ChildFields, GuardianFields, LinkFields } from './FormSections';

const SERVER_DATE_ERRORS: Record<string, TranslationKey> = {
  DATE_OF_BIRTH_IN_FUTURE: 'children.form.errors.dobFuture',
  INVALID_DATE_OF_BIRTH: 'children.form.errors.dobInvalid',
  CHILD_AGE_OUT_OF_RANGE: 'children.form.errors.tooOld',
};

type Phase = 'form' | 'review';

interface Props {
  /** Registering a sibling: that child's current guardians can be reused (no duplicate person). */
  siblingOf?: string;
  now?: () => Date;
}

/**
 * Child registration: one form in simple sections -> review -> confirm. Nothing is saved on the
 * phone; the form keeps its values in memory while the screen is open, also after a failed
 * submission. Success is shown only after the API confirmed it.
 */
export function RegisterChildForm({ siblingOf, now = () => new Date() }: Props) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const childrenApi = useChildrenApi();
  const invalidate = useInvalidateChildData();
  const areas = useRegistrationAreas();
  const sibling = useChild(siblingOf ?? '');
  const schema = useMemo(() => createRegistrationSchema(now), [now]);

  const [phase, setPhase] = useState<Phase>('form');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateChildDetails['candidates'] | null>(null);
  const [guardianDuplicates, setGuardianDuplicates] = useState<DuplicateGuardianDetails['candidates'] | null>(
    null,
  );
  const [confirmDifferent, setConfirmDifferent] = useState(false);
  const [chosenExisting, setChosenExisting] = useState<{ id: string; name: string } | null>(null);
  const [done, setDone] = useState<ChildDetail | null>(null);
  const confirmations = useRef<DuplicateConfirmations>({
    confirmNotDuplicate: false,
    confirmNewGuardian: false,
  });
  const inFlight = useRef(false);
  // Same request content -> same submission id, so a retry after a lost response is answered
  // with the first result instead of creating a second child.
  const submission = useRef<{ id: string; key: string } | null>(null);

  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyRegistration,
  });
  const { control, handleSubmit, setValue, getValues, setError, reset, formState } = form;
  const guardianSource = useWatch({ control, name: 'guardianSource' });
  const areaId = useWatch({ control, name: 'areaId' });

  const areaItems = useMemo(() => areas.data?.items ?? [], [areas.data]);
  useEffect(() => {
    if (areaItems.length === 1 && !getValues('areaId')) setValue('areaId', areaItems[0]!.id);
  }, [areaItems, getValues, setValue]);

  const siblingGuardians = sibling.data?.guardians ?? [];

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setServerError(null);
    try {
      const values = getValues();
      const draft = toRegisterRequest(values, '', confirmations.current);
      const key = JSON.stringify({ ...draft, clientOperationId: undefined });
      if (submission.current?.key !== key) submission.current = { id: newSubmissionId(), key };
      const response = await childrenApi.register({ ...draft, clientOperationId: submission.current.id });
      await invalidate();
      setDuplicates(null);
      setGuardianDuplicates(null);
      setDone(response.child);
    } catch (error) {
      handleError(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function handleError(error: unknown) {
    if (isApiError(error) && error.status === 409 && error.code === 'POSSIBLE_DUPLICATE') {
      const parsed = duplicateChildDetailsSchema.safeParse(error.details);
      setDuplicates(parsed.success ? parsed.data.candidates : []);
      return;
    }
    if (isApiError(error) && error.status === 409 && error.code === 'POSSIBLE_DUPLICATE_GUARDIAN') {
      const parsed = duplicateGuardianDetailsSchema.safeParse(error.details);
      setGuardianDuplicates(parsed.success ? parsed.data.candidates : []);
      return;
    }
    if (isApiError(error) && error.status === 422 && error.code && SERVER_DATE_ERRORS[error.code]) {
      setPhase('form');
      setError(getValues('dobMode') === 'exact' ? 'day' : 'ageYears', {
        message: SERVER_DATE_ERRORS[error.code],
      });
      return;
    }
    if (isApiError(error) && error.status === 403 && error.code === 'AREA_NOT_ALLOWED') {
      setServerError('children.register.errors.areaNotAllowed');
      return;
    }
    if (isApiError(error) && error.status === 404) {
      setServerError('children.register.errors.guardianUnavailable');
      return;
    }
    if (isApiError(error) && error.code === 'IDEMPOTENCY_KEY_REUSED') submission.current = null;
    setServerError(apiErrorMessageKey(error));
  }

  const goToReview = () => {
    handleSubmit(() => {
      setPhase('review');
      setServerError(null);
    })().catch(() => undefined);
  };

  const startOver = () => {
    reset(emptyRegistration);
    if (areaItems.length === 1) setValue('areaId', areaItems[0]!.id);
    confirmations.current = { confirmNotDuplicate: false, confirmNewGuardian: false };
    submission.current = null;
    setChosenExisting(null);
    setDuplicates(null);
    setGuardianDuplicates(null);
    setDone(null);
    setPhase('form');
  };

  // ------------------------------------------------------------------ done
  if (done) {
    return (
      <View style={styles.stack} testID="register-success">
        <InlineAlert tone="info" message={t('children.register.success')} />
        <AppCard>
          <AppText variant="subtitle" accessibilityRole="header">
            {done.fullName}
          </AppText>
          <AppText>{birthText(t, done, now())}</AppText>
          <AppText color="textSecondary">{areaLabel(language, done)}</AppText>
        </AppCard>
        <PrimaryButton
          label={t('children.register.openProfile')}
          onPress={() => router.replace(childRoutes.profile(done.id))}
          testID="register-open-profile"
        />
        <AppButton variant="secondary" label={t('children.register.another')} onPress={startOver} />
      </View>
    );
  }

  if (areas.isPending) return <LoadingIndicator label={t('common.loading')} />;
  if (areas.isError) {
    return <ErrorState message={t(apiErrorMessageKey(areas.error))} onRetry={() => void areas.refetch()} />;
  }
  if (areaItems.length === 0) {
    return <InlineAlert tone="warning" message={t('children.register.noAreas')} testID="register-no-areas" />;
  }

  const selectedArea = areaItems.find((a) => a.id === areaId);
  const fieldError = (message?: string) => {
    const key = validationMessageKey(message);
    return key ? t(key) : undefined;
  };

  // ------------------------------------------------------------------ review
  if (phase === 'review') {
    const values = getValues();
    const birth = birthPayload(values);
    const preview = {
      dateOfBirth: birth.dateOfBirth ?? '',
      dobIsEstimated: Boolean(birth.ageEstimate),
    };
    const guardianName =
      values.guardianSource === 'existing'
        ? (chosenExisting?.name ??
          siblingGuardians.find((g) => g.guardianId === values.existingGuardianId)?.fullName ??
          '')
        : values.guardianName;
    const phone = values.guardianSource === 'new' ? normalizeIndianMobile(values.guardianPhone) : null;

    return (
      <View style={styles.stack} testID="register-review">
        <SectionHeader
          title={t('children.register.reviewTitle')}
          subtitle={t('children.register.reviewSubtitle')}
        />
        <AppCard>
          <ReviewRow label={t('children.form.childName')} value={values.fullName.trim()} />
          <ReviewRow
            label={t('children.form.dobLabel')}
            value={
              birth.ageEstimate
                ? t('children.age.estimatedInput', {
                    years: birth.ageEstimate.years,
                    months: birth.ageEstimate.months,
                  })
                : birthText(t, preview, now())
            }
          />
          <ReviewRow
            label={t('children.form.sexLabel')}
            value={values.sexAtBirth ? sexLabel(t, values.sexAtBirth) : t('children.sex.NOT_RECORDED')}
          />
          <ReviewRow
            label={t('children.form.area')}
            value={
              selectedArea
                ? areaLabel(language, { areaName: selectedArea.nameEn, areaNameHi: selectedArea.nameHi })
                : ''
            }
          />
        </AppCard>
        <AppCard>
          <ReviewRow label={t('children.form.guardianName')} value={guardianName.trim()} />
          {values.guardianSource === 'existing' ? (
            <StatusBadge label={t('children.register.existingGuardian')} tone="info" />
          ) : null}
          <ReviewRow
            label={t('children.form.relationship')}
            value={values.relationship ? relationshipLabel(t, values.relationship) : ''}
          />
          {values.guardianSource === 'new' ? (
            <ReviewRow
              label={t('children.form.guardianPhone')}
              value={phone ?? t('children.guardian.noPhone')}
            />
          ) : null}
          <ReviewRow
            label={t('children.form.consentAuthority')}
            value={values.canGiveConsent === 'yes' ? t('common.yes') : t('common.no')}
          />
          <ReviewRow
            label={t('children.form.primaryContact')}
            value={values.isPrimaryContact ? t('common.yes') : t('common.no')}
          />
        </AppCard>

        {serverError ? <InlineAlert message={t(serverError)} testID="register-error" /> : null}

        {duplicates ? (
          <DuplicateChildren
            candidates={duplicates}
            onOpen={(id) => router.push(childRoutes.profile(id))}
            onRegisterAnyway={() => setConfirmDifferent(true)}
          />
        ) : null}

        {guardianDuplicates ? (
          <AppCard testID="guardian-duplicates">
            <AppText variant="bodyStrong">{t('children.register.guardianDuplicateTitle')}</AppText>
            <AppText variant="bodySmall">{t('children.register.guardianDuplicateMessage')}</AppText>
            {guardianDuplicates.map((candidate) => (
              <View key={candidate.guardianId} style={styles.candidate}>
                <AppText variant="bodyStrong">{candidate.fullName}</AppText>
                <AppText variant="bodySmall" color="textSecondary">
                  {candidate.phoneMasked}
                </AppText>
                <AppButton
                  variant="secondary"
                  label={t('children.register.useThisGuardian')}
                  onPress={() => {
                    setValue('guardianSource', 'existing');
                    setValue('existingGuardianId', candidate.guardianId);
                    setChosenExisting({ id: candidate.guardianId, name: candidate.fullName });
                    setGuardianDuplicates(null);
                  }}
                  testID={`use-guardian-${candidate.guardianId}`}
                />
              </View>
            ))}
            <AppButton
              variant="ghost"
              label={t('children.register.differentGuardian')}
              onPress={() => {
                confirmations.current = { ...confirmations.current, confirmNewGuardian: true };
                setGuardianDuplicates(null);
                void submit();
              }}
              testID="guardian-different-person"
            />
          </AppCard>
        ) : null}

        {!duplicates && !guardianDuplicates ? (
          <PrimaryButton
            label={t('children.register.confirm')}
            onPress={() => void submit()}
            loading={submitting}
            testID="register-confirm"
          />
        ) : null}
        <AppButton
          variant="ghost"
          label={t('children.register.edit')}
          onPress={() => {
            setPhase('form');
            setDuplicates(null);
            setGuardianDuplicates(null);
          }}
          disabled={submitting}
          testID="register-back"
        />

        <ConfirmationDialog
          visible={confirmDifferent}
          title={t('children.register.confirmDifferentTitle')}
          message={t('children.register.confirmDifferentMessage')}
          confirmLabel={t('children.register.confirmDifferent')}
          confirming={submitting}
          onConfirm={() => {
            confirmations.current = { ...confirmations.current, confirmNotDuplicate: true };
            setConfirmDifferent(false);
            setDuplicates(null);
            void submit();
          }}
          onCancel={() => setConfirmDifferent(false)}
        />
      </View>
    );
  }

  // ------------------------------------------------------------------ form
  return (
    <View style={styles.stack} testID="register-form">
      <AppText variant="bodySmall" color="textSecondary">
        {t('children.register.requiredNote')}
      </AppText>

      <SectionHeader title={t('children.register.childSection')} />
      <ChildFields control={control} errors={formState.errors} />

      <SectionHeader title={t('children.form.area')} />
      <Controller
        control={control}
        name="areaId"
        render={({ field }) => (
          <ChoiceGroup
            label={`${t('children.form.areaQuestion')} *`}
            options={areaItems.map((area) => ({
              value: area.id,
              label: areaLabel(language, { areaName: area.nameEn, areaNameHi: area.nameHi }),
            }))}
            value={field.value}
            onChange={field.onChange}
            error={fieldError(formState.errors.areaId?.message)}
            testID="area"
          />
        )}
      />
      {areas.data?.truncated ? (
        <AppText variant="caption" color="textSecondary">
          {t('children.register.areasTruncated')}
        </AppText>
      ) : null}

      <SectionHeader
        title={t('children.register.guardianSection')}
        subtitle={t('children.register.guardianSubtitle')}
      />
      {siblingGuardians.length > 0 || chosenExisting ? (
        <Controller
          control={control}
          name="guardianSource"
          render={({ field }) => (
            <ChoiceGroup
              label={t('children.register.guardianSourceQuestion')}
              options={[
                ...siblingGuardians.map((g) => ({
                  value: `existing:${g.guardianId}`,
                  label: `${g.fullName} (${relationshipLabel(t, g.relationship)})`,
                })),
                ...(chosenExisting && !siblingGuardians.some((g) => g.guardianId === chosenExisting.id)
                  ? [{ value: `existing:${chosenExisting.id}`, label: chosenExisting.name }]
                  : []),
                { value: 'new', label: t('children.register.newGuardian') },
              ]}
              value={field.value === 'existing' ? `existing:${getValues('existingGuardianId')}` : field.value}
              onChange={(choice) => {
                if (choice === 'new') {
                  field.onChange('new');
                  setValue('existingGuardianId', '');
                } else {
                  setValue('existingGuardianId', choice.slice('existing:'.length));
                  field.onChange('existing');
                }
              }}
              testID="guardian-source"
            />
          )}
        />
      ) : null}
      {guardianSource === 'new' ? <GuardianFields control={control} errors={formState.errors} /> : null}
      <LinkFields control={control} errors={formState.errors} />

      {serverError ? <InlineAlert message={t(serverError)} testID="register-error" /> : null}
      <PrimaryButton
        label={t('children.register.review')}
        onPress={goToReview}
        testID="register-review-button"
      />
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

function DuplicateChildren({
  candidates,
  onOpen,
  onRegisterAnyway,
}: {
  candidates: DuplicateChildDetails['candidates'];
  onOpen: (id: string) => void;
  onRegisterAnyway: () => void;
}) {
  const { t, language } = useTranslation();
  return (
    <AppCard testID="duplicate-children">
      <AppText variant="bodyStrong" accessibilityRole="header">
        {t('children.register.duplicateTitle')}
      </AppText>
      <AppText variant="bodySmall">{t('children.register.duplicateMessage')}</AppText>
      {candidates.map((candidate) => (
        <View key={candidate.id} style={styles.candidate}>
          <AppText variant="bodyStrong">{candidate.fullName}</AppText>
          <AppText variant="bodySmall">{birthText(t, candidate)}</AppText>
          <AppText variant="bodySmall" color="textSecondary">
            {areaLabel(language, candidate)}
          </AppText>
          <AppButton
            variant="secondary"
            label={t('children.register.openExisting')}
            onPress={() => onOpen(candidate.id)}
            testID={`open-duplicate-${candidate.id}`}
          />
        </View>
      ))}
      <AppButton
        variant="ghost"
        label={t('children.register.notDuplicate')}
        onPress={onRegisterAnyway}
        testID="register-anyway"
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  reviewRow: { gap: spacing.xxs, paddingVertical: spacing.xs },
  candidate: { gap: spacing.xs, paddingVertical: spacing.sm },
});
