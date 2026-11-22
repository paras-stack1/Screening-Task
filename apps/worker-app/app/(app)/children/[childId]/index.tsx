import type { GuardianLink } from '@balswasthya/shared-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppText,
  EmptyState,
  ErrorState,
  LoadingIndicator,
  ScreenContainer,
  SectionHeader,
  StatusBadge,
} from '../../../../src/components';
import { useChild, useChildPermissions } from '../../../../src/features/children/hooks';
import {
  areaLabel,
  birthText,
  formatIndiaDate,
  relationshipLabel,
  sexLabel,
} from '../../../../src/features/children/labels';
import { childRoutes } from '../../../../src/features/children/routes';
import { useTranslation } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { isApiError } from '../../../../src/services/api/errors';
import { spacing } from '../../../../src/theme';

/**
 * Child profile. Shows only what the API returned for this worker (phone numbers masked).
 * Action buttons follow the worker's permissions from /auth/me; the API still checks each action.
 */
export default function ChildProfileScreen() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const { t, language } = useTranslation();
  const router = useRouter();
  const permissions = useChildPermissions();
  const child = useChild(childId ?? '');

  if (child.isPending) {
    return (
      <ScreenContainer edges={['left', 'right']}>
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (child.isError) {
    const notFound = isApiError(child.error) && child.error.status === 404;
    return (
      <ScreenContainer edges={['left', 'right']} testID="child-profile-error">
        {notFound ? (
          <EmptyState
            icon="account-question-outline"
            title={t('children.profile.notFound')}
            testID="child-not-found"
          />
        ) : (
          <ErrorState message={t(apiErrorMessageKey(child.error))} onRetry={() => void child.refetch()} />
        )}
      </ScreenContainer>
    );
  }

  const data = child.data;
  return (
    <ScreenContainer edges={['left', 'right']} testID="child-profile">
      <AppCard>
        <AppText variant="title" accessibilityRole="header">
          {data.fullName}
        </AppText>
        <Field label={t('children.form.dobLabel')} value={birthText(t, data)} />
        {data.dobIsEstimated ? (
          <StatusBadge label={t('children.profile.estimatedBadge')} tone="warning" />
        ) : null}
        <Field label={t('children.form.sexLabel')} value={sexLabel(t, data.sexAtBirth)} />
        {permissions.canUpdate ? (
          <AppButton
            variant="secondary"
            icon="pencil-outline"
            label={t('children.profile.edit')}
            onPress={() => router.push(childRoutes.edit(data.id))}
            testID="child-edit"
          />
        ) : null}
      </AppCard>

      <SectionHeader title={t('children.profile.guardiansTitle')} />
      {data.guardians.length === 0 ? (
        <AppCard>
          <AppText>{t('children.profile.noGuardians')}</AppText>
        </AppCard>
      ) : (
        data.guardians.map((link) => (
          <GuardianLinkCard
            key={link.relationshipId}
            link={link}
            canUpdate={permissions.canUpdate}
            onOpenGuardian={() => router.push(childRoutes.guardian(link.guardianId))}
            onChange={() => router.push(childRoutes.link(data.id, link.relationshipId))}
          />
        ))
      )}
      {permissions.canUpdate ? (
        <AppButton
          variant="secondary"
          icon="account-plus-outline"
          label={t('children.profile.addGuardian')}
          onPress={() => router.push(childRoutes.addGuardian(data.id))}
          testID="child-add-guardian"
        />
      ) : null}
      {permissions.canCreate ? (
        <AppButton
          variant="ghost"
          icon="account-multiple-plus-outline"
          label={t('children.profile.registerSibling')}
          onPress={() => router.push(childRoutes.register(data.id))}
          testID="child-register-sibling"
        />
      ) : null}

      <SectionHeader title={t('children.profile.registrationTitle')} />
      <AppCard>
        <Field label={t('children.form.area')} value={areaLabel(language, data)} />
        <Field label={t('children.profile.registeredOn')} value={formatIndiaDate(data.registeredAt)} />
        <Field label={t('children.profile.registeredBy')} value={data.registeredByName} />
      </AppCard>

      <SectionHeader title={t('children.profile.screeningTitle')} />
      <AppCard testID="screening-placeholder">
        <AppText color="textSecondary">{t('children.profile.screeningNotAvailable')}</AppText>
      </AppCard>
    </ScreenContainer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

function GuardianLinkCard({
  link,
  canUpdate,
  onOpenGuardian,
  onChange,
}: {
  link: GuardianLink;
  canUpdate: boolean;
  onOpenGuardian: () => void;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AppCard testID={`guardian-link-${link.relationshipId}`}>
      <AppText variant="subtitle">{link.fullName}</AppText>
      <AppText>{relationshipLabel(t, link.relationship)}</AppText>
      <View style={styles.badges}>
        {link.isPrimaryContact ? <StatusBadge label={t('children.link.primaryBadge')} tone="info" /> : null}
        <StatusBadge
          label={link.canGiveConsent ? t('children.link.mayConsent') : t('children.link.mayNotConsent')}
          tone="neutral"
          icon={link.canGiveConsent ? 'account-check-outline' : 'account-cancel-outline'}
        />
      </View>
      <AppText variant="bodySmall" color="textSecondary">
        {link.phoneMasked ?? t('children.guardian.noPhone')}
      </AppText>
      <AppButton variant="ghost" label={t('children.link.openGuardian')} onPress={onOpenGuardian} />
      {canUpdate ? (
        <AppButton
          variant="ghost"
          label={t('children.link.change')}
          onPress={onChange}
          testID={`change-link-${link.relationshipId}`}
        />
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xxs, paddingVertical: spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
