import { useLocalSearchParams } from 'expo-router';
import { EmptyState, ErrorState, LoadingIndicator, ScreenContainer } from '../../../../src/components';
import { GuardianDetails } from '../../../../src/features/children/components/GuardianDetails';
import { ParentPortalCard } from '../../../../src/features/children/components/ParentPortalCard';
import { useChildPermissions, useGuardian } from '../../../../src/features/children/hooks';
import { View } from 'react-native';
import { useTranslation } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { isApiError } from '../../../../src/services/api/errors';
import { spacing } from '../../../../src/theme';

export default function GuardianScreen() {
  const { guardianId } = useLocalSearchParams<{ guardianId: string }>();
  const { t } = useTranslation();
  const permissions = useChildPermissions();
  const guardian = useGuardian(guardianId ?? '');

  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="guardian-screen">
      {guardian.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : guardian.isError ? (
        isApiError(guardian.error) && guardian.error.status === 404 ? (
          <EmptyState icon="account-question-outline" title={t('children.guardian.notFound')} />
        ) : (
          <ErrorState
            message={t(apiErrorMessageKey(guardian.error))}
            onRetry={() => void guardian.refetch()}
          />
        )
      ) : (
        <View style={{ gap: spacing.xl }}>
          <GuardianDetails
            key={guardian.data.updatedAt}
            guardian={guardian.data}
            canUpdate={permissions.canUpdate}
            onReload={() => void guardian.refetch()}
          />
          {/* Step 8: Parent Portal invitation (status for every reader; invite needs guardian.invite). */}
          <ParentPortalCard guardianId={guardian.data.id} canInvite={permissions.canInviteGuardian} />
        </View>
      )}
    </ScreenContainer>
  );
}
