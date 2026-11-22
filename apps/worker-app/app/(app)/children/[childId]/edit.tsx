import { useLocalSearchParams } from 'expo-router';
import { ErrorState, LoadingIndicator, ScreenContainer } from '../../../../src/components';
import { EditChildForm } from '../../../../src/features/children/components/EditChildForm';
import { useChild } from '../../../../src/features/children/hooks';
import { useTranslation } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';

/** Correct a child's name, date of birth or sex. The area cannot be changed here. */
export default function EditChildScreen() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const { t } = useTranslation();
  const child = useChild(childId ?? '');
  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="edit-child-screen">
      {child.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : child.isError ? (
        <ErrorState message={t(apiErrorMessageKey(child.error))} onRetry={() => void child.refetch()} />
      ) : (
        // Keyed by version: after a reload the form starts from the newest saved values.
        <EditChildForm key={child.data.updatedAt} child={child.data} onReload={() => void child.refetch()} />
      )}
    </ScreenContainer>
  );
}
