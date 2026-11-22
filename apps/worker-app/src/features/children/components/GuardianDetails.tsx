import type { GuardianDetail } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';
import {
  AppButton,
  AppCard,
  AppIcon,
  AppText,
  InlineAlert,
  PrimaryButton,
  SectionHeader,
} from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { apiErrorMessageKey } from '../../../services/api/errorMessages';
import { isApiError } from '../../../services/api/errors';
import { colors, radius, spacing, touchTarget } from '../../../theme';
import { useChildrenApi, useInvalidateChildData } from '../hooks';
import { relationshipLabel } from '../labels';
import { childRoutes } from '../routes';
import { validateGuardianFields, type GuardianFieldValues } from '../validation';
import { GuardianFields } from './FormSections';

const schema = z
  .custom<GuardianFieldValues>()
  .superRefine((values, ctx) => validateGuardianFields(values, ctx));

/**
 * Guardian profile. The full phone number is shown only here (the API audits this view). The
 * child list contains only children this worker may access - other children of the household
 * are never shown (the API does not send them).
 */
export function GuardianDetails({
  guardian,
  canUpdate,
  onReload,
}: {
  guardian: GuardianDetail;
  canUpdate: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const childrenApi = useChildrenApi();
  const invalidate = useInvalidateChildData();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);

  const { control, handleSubmit, formState } = useForm<GuardianFieldValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      guardianName: guardian.fullName,
      guardianPhone: guardian.phone ?? '',
      guardianLanguage: guardian.preferredLanguage === 'en' ? 'en' : 'hi',
    },
  });

  const save = (values: GuardianFieldValues) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setServerError(null);
    const phone = values.guardianPhone.trim();
    const phoneChange = phone === (guardian.phone ?? '') ? {} : { phone: phone === '' ? null : phone };
    childrenApi
      .updateGuardian(guardian.id, {
        expectedUpdatedAt: guardian.updatedAt,
        fullName: values.guardianName,
        preferredLanguage: values.guardianLanguage,
        ...phoneChange,
      })
      .then(async () => {
        await invalidate();
        setEditing(false);
      })
      .catch((error: unknown) => {
        if (isApiError(error) && error.code === 'STALE_RECORD') setStale(true);
        else if (isApiError(error) && error.status === 404) setServerError('children.guardian.notFound');
        else setServerError(apiErrorMessageKey(error));
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };

  return (
    <View style={styles.stack}>
      <AppCard>
        <AppText variant="title" accessibilityRole="header">
          {guardian.fullName}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {t('children.form.guardianPhone')}
        </AppText>
        <AppText testID="guardian-phone-value">{guardian.phone ?? t('children.guardian.noPhone')}</AppText>
        <AppText variant="caption" color="textSecondary">
          {t('children.form.guardianLanguage')}
        </AppText>
        <AppText>{guardian.preferredLanguage === 'en' ? 'English' : 'हिंदी'}</AppText>
      </AppCard>
      <AppText variant="caption" color="textSecondary">
        {t('children.guardian.phonePrivacy')}
      </AppText>

      <SectionHeader
        title={t('children.guardian.childrenTitle')}
        subtitle={t('children.guardian.childrenSubtitle')}
      />
      {guardian.children.map((child) => (
        <Pressable
          key={child.relationshipId}
          accessibilityRole="button"
          accessibilityLabel={`${child.childName}, ${relationshipLabel(t, child.relationship)}`}
          onPress={() => router.push(childRoutes.profile(child.childId))}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={styles.rowText}>
            <AppText variant="bodyStrong">{child.childName}</AppText>
            <AppText variant="bodySmall">{relationshipLabel(t, child.relationship)}</AppText>
          </View>
          <AppIcon name="chevron-right" color={colors.textSecondary} />
        </Pressable>
      ))}

      {stale ? (
        <View style={styles.stack} testID="guardian-stale">
          <InlineAlert tone="warning" message={t('children.edit.stale')} />
          <AppButton variant="secondary" icon="sync" label={t('children.edit.reload')} onPress={onReload} />
        </View>
      ) : null}
      {serverError ? <InlineAlert message={t(serverError)} testID="guardian-error" /> : null}

      {canUpdate && !editing ? (
        <AppButton
          variant="secondary"
          icon="pencil-outline"
          label={t('children.guardian.edit')}
          onPress={() => setEditing(true)}
          testID="guardian-edit"
        />
      ) : null}
      {editing ? (
        <View style={styles.stack}>
          <SectionHeader title={t('children.guardian.edit')} subtitle={t('children.guardian.sharedNote')} />
          <GuardianFields control={control} errors={formState.errors} disabled={saving} />
          <PrimaryButton
            label={t('children.edit.save')}
            loading={saving}
            disabled={stale}
            onPress={() => void handleSubmit(save)()}
            testID="guardian-save"
          />
          <AppButton
            variant="ghost"
            label={t('common.cancel')}
            onPress={() => setEditing(false)}
            disabled={saving}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.primarySurface },
  rowText: { flex: 1, gap: spacing.xxs },
});
