import type { GuardianLink, GuardianRelationship } from '@balswasthya/shared-contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ConfirmationDialog,
  InlineAlert,
  PrimaryButton,
  SectionHeader,
} from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { apiErrorMessageKey } from '../../../services/api/errorMessages';
import { isApiError } from '../../../services/api/errors';
import { spacing } from '../../../theme';
import { useChildrenApi, useInvalidateChildData } from '../hooks';
import { validateLinkFields, type LinkFieldValues } from '../validation';
import { LinkFields } from './FormSections';

const schema = z.custom<LinkFieldValues>().superRefine((values, ctx) => validateLinkFields(values, ctx));

/**
 * Change or end one child-guardian link. Ending keeps the history (the API never deletes it).
 * Changing consent authority affects whether this person's consent decisions count, so both
 * actions ask for confirmation.
 */
export function EditLinkForm({ childId, link }: { childId: string; link: GuardianLink }) {
  const { t } = useTranslation();
  const router = useRouter();
  const childrenApi = useChildrenApi();
  const invalidate = useInvalidateChildData();
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [confirm, setConfirm] = useState<'save' | 'remove' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const pending = useRef<LinkFieldValues | null>(null);
  const inFlight = useRef(false);

  const { control, handleSubmit, formState } = useForm<LinkFieldValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      relationship: link.relationship as GuardianRelationship,
      canGiveConsent: link.canGiveConsent ? 'yes' : 'no',
      isPrimaryContact: link.isPrimaryContact,
    },
  });

  const run = (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setServerError(null);
    action()
      .then(async () => {
        await invalidate();
        setConfirm(null);
        router.back();
      })
      .catch((error: unknown) => {
        setConfirm(null);
        if (isApiError(error) && error.code === 'LAST_GUARDIAN') setServerError('children.link.lastGuardian');
        else if (isApiError(error) && error.status === 404) setServerError('children.link.notFound');
        else setServerError(apiErrorMessageKey(error));
      })
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };

  const save = () => {
    const values = pending.current;
    if (!values) return;
    run(() =>
      childrenApi.updateLink(childId, link.relationshipId, {
        relationship: values.relationship as GuardianRelationship,
        canGiveConsent: values.canGiveConsent === 'yes',
        isPrimaryContact: values.isPrimaryContact,
      }),
    );
  };

  const consentChanged = (values: LinkFieldValues) =>
    (values.canGiveConsent === 'yes') !== link.canGiveConsent;

  return (
    <View style={styles.stack}>
      <AppCard>
        <AppText variant="subtitle">{link.fullName}</AppText>
      </AppCard>
      <LinkFields control={control} errors={formState.errors} disabled={busy} />
      {serverError ? <InlineAlert message={t(serverError)} testID="link-error" /> : null}
      <PrimaryButton
        label={t('children.link.save')}
        loading={busy && confirm !== 'remove'}
        onPress={() =>
          void handleSubmit((values) => {
            pending.current = values;
            if (consentChanged(values)) setConfirm('save');
            else save();
          })()
        }
        testID="link-save"
      />

      <SectionHeader title={t('children.link.removeTitle')} subtitle={t('children.link.removeSubtitle')} />
      <AppInput
        label={`${t('children.link.reason')} *`}
        hint={t('children.link.reasonHint')}
        value={reason}
        onChangeText={(value) => {
          setReason(value);
          setReasonError(false);
        }}
        error={reasonError ? t('children.link.reasonRequired') : undefined}
        maxLength={200}
        editable={!busy}
        testID="link-remove-reason"
      />
      <AppButton
        variant="danger"
        icon="link-variant-remove"
        label={t('children.link.remove')}
        disabled={busy}
        onPress={() => {
          if (reason.trim().length < 3) setReasonError(true);
          else setConfirm('remove');
        }}
        testID="link-remove"
      />

      <ConfirmationDialog
        visible={confirm === 'save'}
        title={t('children.link.consentChangeTitle')}
        message={t('children.link.consentChangeMessage')}
        confirming={busy}
        onConfirm={save}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationDialog
        visible={confirm === 'remove'}
        title={t('children.link.removeConfirmTitle', { name: link.fullName })}
        message={t('children.link.removeConfirmMessage')}
        confirmLabel={t('children.link.remove')}
        destructive
        confirming={busy}
        onConfirm={() => run(() => childrenApi.endLink(childId, link.relationshipId, reason.trim()))}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({ stack: { gap: spacing.md } });
