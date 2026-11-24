import type { ParentInvitationStatus, ParentPortalStatus } from '@balswasthya/shared-contracts';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppIcon,
  AppInput,
  AppText,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  SectionHeader,
  StatusBadge,
  type StatusTone,
} from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { apiErrorMessageKey } from '../../../services/api/errorMessages';
import { isApiError } from '../../../services/api/errors';
import { colors, radius, spacing, touchTarget } from '../../../theme';
import { useChildrenApi, useInvalidateChildData, useParentPortalStatus } from '../hooks';
import { formatIndiaDateTime, relationshipLabel } from '../labels';

const STATUS_TONE: Record<ParentInvitationStatus, StatusTone> = {
  NOT_INVITED: 'neutral',
  INVITATION_PENDING: 'warning',
  INVITATION_SENT: 'info',
  ACTIVATED: 'success',
  EXPIRED: 'warning',
  REVOKED: 'neutral',
};

const ERROR_KEYS: Record<string, TranslationKey> = {
  INVITATION_LIMIT: 'parentPortal.errors.limit',
  PARENT_PORTAL_NOT_CONFIGURED: 'parentPortal.errors.notConfigured',
  GUARDIAN_PHONE_MISSING: 'parentPortal.errors.noPhone',
  CHILD_NOT_LINKED: 'parentPortal.errors.childNotLinked',
  ALREADY_ACTIVATED: 'parentPortal.errors.alreadyActivated',
  INVITATION_NOT_OPEN: 'parentPortal.errors.notOpen',
};

function errorKey(error: unknown): TranslationKey {
  if (isApiError(error) && error.code && ERROR_KEYS[error.code]) return ERROR_KEYS[error.code]!;
  if (isApiError(error) && error.status === 404) return 'children.guardian.notFound';
  return apiErrorMessageKey(error);
}

/**
 * Parent Portal invitation for one guardian (Step 8, stage 3; PP4, PP5, PP11). The worker
 * confirms the guardian agreed and which children they may see; the API sends the link by SMS.
 * The worker never sees the link, a code or a password - the parent creates their own password
 * after verifying their mobile number. The API decides whether an invitation is possible.
 */
export function ParentPortalCard({ guardianId, canInvite }: { guardianId: string; canInvite: boolean }) {
  const { t } = useTranslation();
  const portal = useParentPortalStatus(guardianId);

  return (
    <View style={styles.stack} testID="parent-portal-card">
      <SectionHeader title={t('parentPortal.title')} subtitle={t('parentPortal.subtitle')} />
      {portal.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : portal.isError ? (
        <ErrorState message={t(errorKey(portal.error))} onRetry={() => void portal.refetch()} />
      ) : (
        <PortalBody status={portal.data} canInvite={canInvite} />
      )}
    </View>
  );
}

function PortalBody({ status, canInvite }: { status: ParentPortalStatus; canInvite: boolean }) {
  const { t } = useTranslation();
  const api = useChildrenApi();
  const invalidate = useInvalidateChildData();
  const [mode, setMode] = useState<'view' | 'invite' | 'revoke'>('view');
  const [selected, setSelected] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<TranslationKey | null>(null);
  const [serverError, setServerError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const invitation = status.latestInvitation;
  const open = status.status === 'INVITATION_PENDING' || status.status === 'INVITATION_SENT';
  const mayAct = canInvite && status.blockedReason !== 'NOT_ALLOWED';
  const selectable = status.children.filter((c) => c.access !== 'ACTIVE');

  const run = (work: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setServerError(null);
    work()
      .then(async () => {
        await invalidate();
        setMode('view');
        setSelected([]);
        setAgreed(false);
        setReason('');
      })
      .catch((error: unknown) => setServerError(errorKey(error)))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };

  const send = () => {
    if (selected.length === 0) return setFormError('parentPortal.errors.chooseChild');
    if (!agreed) return setFormError('parentPortal.errors.agreementRequired');
    setFormError(null);
    run(() => api.inviteParent(status.guardianId, { guardianAgreed: true, childIds: selected }));
  };

  const revoke = () => {
    if (reason.trim().length < 3) return setFormError('parentPortal.errors.reasonRequired');
    setFormError(null);
    run(() => api.revokeParentInvitation(status.guardianId, invitation!.id, reason.trim()));
  };

  const toggle = (childId: string) =>
    setSelected((current) =>
      current.includes(childId) ? current.filter((id) => id !== childId) : [...current, childId],
    );

  return (
    <View style={styles.stack}>
      <AppCard>
        <View style={styles.stack}>
          <StatusBadge label={t(`parentPortal.status.${status.status}`)} tone={STATUS_TONE[status.status]} />
          <AppText variant="caption" color="textSecondary">
            {t('parentPortal.smsTo')}
          </AppText>
          <AppText testID="parent-portal-phone">
            {status.maskedPhone ?? t('children.guardian.noPhone')}
          </AppText>
          {invitation ? (
            <AppText variant="bodySmall" testID="parent-portal-latest">
              {t('parentPortal.latest', {
                name: invitation.createdByName,
                created: formatIndiaDateTime(invitation.createdAt),
                expires: formatIndiaDateTime(invitation.expiresAt),
              })}
            </AppText>
          ) : null}
          {status.children.map((child) => (
            <AppText key={child.childId} variant="bodySmall">
              {`${child.childName} (${relationshipLabel(t, child.relationship)}): ${t(
                `parentPortal.access.${child.access}`,
              )}`}
            </AppText>
          ))}
        </View>
      </AppCard>

      {open && invitation?.smsStatus === 'NOT_CONFIGURED' ? (
        <InlineAlert
          tone="warning"
          message={t('parentPortal.smsNotConfigured')}
          testID="parent-portal-sms-off"
        />
      ) : null}
      {open && invitation?.smsStatus === 'FAILED' ? (
        <InlineAlert tone="warning" message={t('parentPortal.smsFailed')} />
      ) : null}
      {status.blockedReason === 'NO_PHONE' ? (
        <InlineAlert tone="info" message={t('parentPortal.blocked.NO_PHONE')} />
      ) : null}
      {status.blockedReason === 'ALREADY_ACTIVATED' ? (
        <InlineAlert tone="info" message={t('parentPortal.blocked.ALREADY_ACTIVATED')} />
      ) : null}
      {serverError ? <InlineAlert message={t(serverError)} testID="parent-portal-error" /> : null}

      {mode === 'view' && mayAct && status.canInvite ? (
        <AppButton
          variant="secondary"
          icon="send-outline"
          label={t(invitation ? 'parentPortal.inviteAgain' : 'parentPortal.invite')}
          onPress={() => {
            setFormError(null);
            setMode('invite');
          }}
          testID="parent-portal-invite"
        />
      ) : null}
      {mode === 'view' && mayAct && open ? (
        <AppButton
          variant="ghost"
          icon="close-circle-outline"
          label={t('parentPortal.revoke')}
          onPress={() => {
            setFormError(null);
            setMode('revoke');
          }}
          testID="parent-portal-revoke"
        />
      ) : null}

      {mode === 'invite' ? (
        <View style={styles.stack} testID="parent-portal-invite-form">
          <AppText variant="bodyStrong">{t('parentPortal.chooseChildren')}</AppText>
          {selectable.map((child) => (
            <CheckRow
              key={child.childId}
              label={child.childName}
              checked={selected.includes(child.childId)}
              onChange={() => toggle(child.childId)}
              testID={`parent-portal-child-${child.childId}`}
            />
          ))}
          <CheckRow
            label={t('parentPortal.agreement')}
            checked={agreed}
            onChange={() => setAgreed((v) => !v)}
            testID="parent-portal-agreed"
          />
          <AppText variant="caption" color="textSecondary">
            {t('parentPortal.passwordNote')}
          </AppText>
          {formError ? <InlineAlert message={t(formError)} testID="parent-portal-form-error" /> : null}
          <PrimaryButton
            label={t('parentPortal.send')}
            loading={busy}
            onPress={send}
            testID="parent-portal-send"
          />
          <AppButton
            variant="ghost"
            label={t('common.cancel')}
            onPress={() => setMode('view')}
            disabled={busy}
          />
        </View>
      ) : null}

      {mode === 'revoke' ? (
        <View style={styles.stack} testID="parent-portal-revoke-form">
          <AppInput
            label={t('parentPortal.revokeReason')}
            value={reason}
            onChangeText={setReason}
            maxLength={300}
            editable={!busy}
            testID="parent-portal-revoke-reason"
          />
          {formError ? <InlineAlert message={t(formError)} testID="parent-portal-form-error" /> : null}
          <AppButton
            variant="danger"
            label={t('parentPortal.revokeConfirm')}
            loading={busy}
            onPress={revoke}
            testID="parent-portal-revoke-confirm"
          />
          <AppButton
            variant="ghost"
            label={t('common.cancel')}
            onPress={() => setMode('view')}
            disabled={busy}
          />
        </View>
      ) : null}
    </View>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onChange}
      style={({ pressed }) => [styles.checkbox, checked && styles.checked, pressed && styles.pressed]}
      testID={testID}
    >
      <AppIcon
        name={checked ? 'checkbox-marked-outline' : 'checkbox-blank-outline'}
        color={checked ? colors.primary : colors.textSecondary}
      />
      <AppText style={styles.checkboxText}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
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
