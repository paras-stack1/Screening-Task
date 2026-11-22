import {
  duplicateGuardianDetailsSchema,
  type AddGuardianLinkRequest,
  type DuplicateGuardianDetails,
  type GuardianRelationship,
} from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { AppButton, AppCard, AppText, InlineAlert, PrimaryButton } from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { apiErrorMessageKey } from '../../../services/api/errorMessages';
import { isApiError } from '../../../services/api/errors';
import { spacing } from '../../../theme';
import { newSubmissionId } from '../../../utils/submissionId';
import { useChildrenApi, useInvalidateChildData } from '../hooks';
import {
  validateGuardianFields,
  validateLinkFields,
  type GuardianFieldValues,
  type LinkFieldValues,
} from '../validation';
import { GuardianFields, LinkFields } from './FormSections';

type Values = GuardianFieldValues & LinkFieldValues;

const schema = z.custom<Values>().superRefine((values, ctx) => {
  validateGuardianFields(values, ctx);
  validateLinkFields(values, ctx);
});

/**
 * Adds a guardian to a child. If the phone number belongs to a guardian already registered in
 * the worker's areas, the worker can link that person instead of creating a duplicate.
 */
export function AddGuardianForm({ childId }: { childId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const childrenApi = useChildrenApi();
  const invalidate = useInvalidateChildData();
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [candidates, setCandidates] = useState<DuplicateGuardianDetails['candidates'] | null>(null);
  const inFlight = useRef(false);
  const submission = useRef<{ id: string; key: string } | null>(null);

  const { control, handleSubmit, formState, getValues } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      guardianName: '',
      guardianPhone: '',
      guardianLanguage: 'hi',
      relationship: '',
      canGiveConsent: '',
      isPrimaryContact: false,
    },
  });

  const send = (request: Omit<AddGuardianLinkRequest, 'clientOperationId'>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setServerError(null);
    const key = JSON.stringify(request);
    if (submission.current?.key !== key) submission.current = { id: newSubmissionId(), key };
    childrenApi
      .addLink(childId, { ...request, clientOperationId: submission.current.id })
      .then(async () => {
        await invalidate();
        router.back();
      })
      .catch((error: unknown) => {
        if (isApiError(error) && error.code === 'POSSIBLE_DUPLICATE_GUARDIAN') {
          const parsed = duplicateGuardianDetailsSchema.safeParse(error.details);
          setCandidates(parsed.success ? parsed.data.candidates : []);
        } else if (isApiError(error) && error.code === 'GUARDIAN_ALREADY_LINKED') {
          setServerError('children.addGuardian.alreadyLinked');
        } else if (isApiError(error) && error.status === 404) {
          setServerError('children.profile.notFound');
        } else {
          setServerError(apiErrorMessageKey(error));
        }
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };

  const link = (values: Values) => ({
    relationship: values.relationship as GuardianRelationship,
    isPrimaryContact: values.isPrimaryContact,
    canGiveConsent: values.canGiveConsent === 'yes',
  });

  const newGuardianRequest = (values: Values, confirmNewGuardian: boolean) => ({
    newGuardian: {
      fullName: values.guardianName,
      ...(values.guardianPhone.trim() && { phone: values.guardianPhone.trim() }),
      preferredLanguage: values.guardianLanguage,
    },
    ...link(values),
    confirmNewGuardian,
  });

  return (
    <View style={styles.stack}>
      <GuardianFields control={control} errors={formState.errors} disabled={saving} />
      <LinkFields control={control} errors={formState.errors} disabled={saving} />
      {serverError ? <InlineAlert message={t(serverError)} testID="add-guardian-error" /> : null}

      {candidates ? (
        <AppCard testID="guardian-duplicates">
          <AppText variant="bodyStrong">{t('children.register.guardianDuplicateTitle')}</AppText>
          <AppText variant="bodySmall">{t('children.register.guardianDuplicateMessage')}</AppText>
          {candidates.map((candidate) => (
            <View key={candidate.guardianId} style={styles.candidate}>
              <AppText variant="bodyStrong">{candidate.fullName}</AppText>
              <AppText variant="bodySmall" color="textSecondary">
                {candidate.phoneMasked}
              </AppText>
              <AppButton
                variant="secondary"
                label={t('children.register.useThisGuardian')}
                loading={saving}
                onPress={() => send({ existingGuardianId: candidate.guardianId, ...link(getValues()) })}
                testID={`use-guardian-${candidate.guardianId}`}
              />
            </View>
          ))}
          <AppButton
            variant="ghost"
            label={t('children.register.differentGuardian')}
            disabled={saving}
            onPress={() => send(newGuardianRequest(getValues(), true))}
            testID="guardian-different-person"
          />
        </AppCard>
      ) : (
        <PrimaryButton
          label={t('children.addGuardian.save')}
          loading={saving}
          onPress={() => void handleSubmit((values) => send(newGuardianRequest(values, false)))()}
          testID="add-guardian-save"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  candidate: { gap: spacing.xs, paddingVertical: spacing.sm },
});
