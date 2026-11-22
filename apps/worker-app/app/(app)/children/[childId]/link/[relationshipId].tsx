import { useLocalSearchParams } from 'expo-router';
import { EmptyState, ErrorState, LoadingIndicator, ScreenContainer } from '../../../../../src/components';
import { EditLinkForm } from '../../../../../src/features/children/components/EditLinkForm';
import { useChild } from '../../../../../src/features/children/hooks';
import { useTranslation } from '../../../../../src/localization';
import { apiErrorMessageKey } from '../../../../../src/services/api/errorMessages';

/** The link is looked up in THIS child's current guardians - never loaded by id alone. */
export default function EditLinkScreen() {
  const { childId, relationshipId } = useLocalSearchParams<{ childId: string; relationshipId: string }>();
  const { t } = useTranslation();
  const child = useChild(childId ?? '');
  const link = child.data?.guardians.find((g) => g.relationshipId === relationshipId);

  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="edit-link-screen">
      {child.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : child.isError ? (
        <ErrorState message={t(apiErrorMessageKey(child.error))} onRetry={() => void child.refetch()} />
      ) : !link ? (
        <EmptyState icon="link-variant-off" title={t('children.link.notFound')} />
      ) : (
        <EditLinkForm childId={childId ?? ''} link={link} />
      )}
    </ScreenContainer>
  );
}
