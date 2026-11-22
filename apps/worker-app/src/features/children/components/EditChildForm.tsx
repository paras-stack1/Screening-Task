import type { ChildDetail, SexAtBirth } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { AppButton, AppCard, AppText, InlineAlert, PrimaryButton } from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { apiErrorMessageKey } from '../../../services/api/errorMessages';
import { isApiError } from '../../../services/api/errors';
import { spacing } from '../../../theme';
import { useChildrenApi, useInvalidateChildData } from '../hooks';
import { birthText } from '../labels';
import {
  birthPayload,
  childToFields,
  validateBirthFields,
  validateChildName,
  type ChildFieldValues,
} from '../validation';
import { ChildFields } from './FormSections';

interface EditValues extends ChildFieldValues {
  changeDob: boolean;
}

const DATE_ERRORS: Record<string, TranslationKey> = {
  DATE_OF_BIRTH_IN_FUTURE: 'children.form.errors.dobFuture',
  INVALID_DATE_OF_BIRTH: 'children.form.errors.dobInvalid',
  CHILD_AGE_OUT_OF_RANGE: 'children.form.errors.tooOld',
};

/**
 * Edits with optimistic concurrency: the version the worker started from is sent, and if someone
 * else saved the child in the meantime the API refuses (STALE_RECORD) - nothing is overwritten.
 */
export function EditChildForm({
  child,
  onReload,
  now = () => new Date(),
}: {
  child: ChildDetail;
  onReload: () => void;
  now?: () => Date;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const childrenApi = useChildrenApi();
  const invalidate = useInvalidateChildData();
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);

  const schema = useMemo(
    () =>
      z.custom<EditValues>().superRefine((values, ctx) => {
        validateChildName(values, ctx);
        if (values.changeDob) validateBirthFields(values, now(), ctx);
      }),
    [now],
  );
  const initial: EditValues = { ...childToFields(child), changeDob: false };
  const { control, handleSubmit, setValue, setError, formState } = useForm<EditValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });
  const changeDob = useWatch({ control, name: 'changeDob' });

  const save = (values: EditValues) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setServerError(null);
    childrenApi
      .update(child.id, {
        expectedUpdatedAt: child.updatedAt,
        fullName: values.fullName,
        sexAtBirth: (values.sexAtBirth || 'NOT_RECORDED') as SexAtBirth,
        ...(values.changeDob ? birthPayload(values) : {}),
      })
      .then(async () => {
        await invalidate();
        router.back();
      })
      .catch((error: unknown) => {
        if (isApiError(error) && error.code === 'STALE_RECORD') setStale(true);
        else if (isApiError(error) && error.code && DATE_ERRORS[error.code]) {
          setError(values.dobMode === 'exact' ? 'day' : 'ageYears', { message: DATE_ERRORS[error.code] });
        } else if (isApiError(error) && error.status === 404) setServerError('children.profile.notFound');
        else setServerError(apiErrorMessageKey(error));
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };

  return (
    <View style={styles.stack}>
      <AppText variant="bodySmall" color="textSecondary">
        {t('children.edit.areaNote')}
      </AppText>
      {stale ? (
        <View style={styles.stack} testID="edit-stale">
          <InlineAlert tone="warning" message={t('children.edit.stale')} />
          <AppButton variant="secondary" icon="sync" label={t('children.edit.reload')} onPress={onReload} />
        </View>
      ) : null}

      {!changeDob ? (
        <AppCard>
          <AppText variant="caption" color="textSecondary">
            {t('children.form.dobLabel')}
          </AppText>
          <AppText>{birthText(t, child, now())}</AppText>
          <AppButton
            variant="ghost"
            label={t('children.edit.changeDob')}
            onPress={() => {
              setValue('changeDob', true);
              // An estimated date is re-entered as an approximate age, never shown as exact.
              if (!child.dobIsEstimated) setValue('dobMode', 'exact');
            }}
            disabled={saving}
            testID="edit-change-dob"
          />
        </AppCard>
      ) : null}

      <ChildFields control={control} errors={formState.errors} disabled={saving} hideBirth={!changeDob} />

      {serverError ? <InlineAlert message={t(serverError)} testID="edit-error" /> : null}
      <PrimaryButton
        label={t('children.edit.save')}
        onPress={() => void handleSubmit(save)()}
        loading={saving}
        disabled={stale}
        testID="edit-save"
      />
    </View>
  );
}

const styles = StyleSheet.create({ stack: { gap: spacing.md } });
