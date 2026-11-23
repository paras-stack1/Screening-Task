import type { ScreeningSessionDetail } from '@balswasthya/shared-contracts';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { AppButton, AppCard, AppInput, AppText, ConfirmationDialog, InlineAlert } from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { spacing } from '../../../theme';
import { isVersionConflict, sessionErrorKey } from '../errors';
import { useApplySessionUpdate, useRefetchSession, useScreeningApi } from '../hooks';
import { screeningRoutes } from '../routes';

/**
 * Cancel an open screening with a short reason (no personal data). Allowed even after consent was
 * withdrawn. The record is kept as CANCELLED - never deleted - and a new screening can start later.
 */
export function CancelSessionCard({ session }: { session: ScreeningSessionDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const api = useScreeningApi();
  const apply = useApplySessionUpdate();
  const refetch = useRefetchSession(session.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const inFlight = useRef(false);

  const cancel = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      apply(await api.cancel(session.id, session.version, reason.trim()));
      setConfirming(false);
      router.replace(screeningRoutes.summary(session.id));
    } catch (err) {
      setConfirming(false);
      if (isVersionConflict(err)) void refetch();
      setError(sessionErrorKey(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <AppButton
        variant="ghost"
        icon="close-circle-outline"
        label={t('screening.cancel.open')}
        onPress={() => setOpen(true)}
        testID="session-cancel-open"
      />
    );
  }
  return (
    <AppCard style={styles.card} testID="session-cancel">
      <AppText variant="bodyStrong">{t('screening.cancel.title')}</AppText>
      <AppText variant="bodySmall" color="textSecondary">
        {t('screening.cancel.explain')}
      </AppText>
      <AppInput
        label={t('screening.cancel.reason')}
        hint={t('screening.question.notesHint')}
        value={reason}
        onChangeText={(value) => {
          setReason(value);
          setInvalid(false);
        }}
        error={invalid ? t('screening.cancel.reasonRequired') : undefined}
        maxLength={200}
        testID="session-cancel-reason"
      />
      {error ? <InlineAlert tone="danger" message={t(error)} testID="session-cancel-error" /> : null}
      <AppButton
        variant="danger"
        icon="close-circle-outline"
        label={t('screening.cancel.confirm')}
        onPress={() => (reason.trim().length < 3 ? setInvalid(true) : setConfirming(true))}
        testID="session-cancel-confirm"
      />
      <AppButton variant="secondary" label={t('screening.cancel.keep')} onPress={() => setOpen(false)} />
      <ConfirmationDialog
        visible={confirming}
        title={t('screening.cancel.dialogTitle')}
        message={t('screening.cancel.dialogMessage')}
        confirmLabel={t('screening.cancel.confirm')}
        cancelLabel={t('screening.cancel.keep')}
        destructive
        confirming={busy}
        onConfirm={() => void cancel()}
        onCancel={() => setConfirming(false)}
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.sm } });
