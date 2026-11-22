import { useLocalSearchParams } from 'expo-router';
import { ErrorState, LoadingIndicator, ScreenContainer } from '../../../../../src/components';
import { useChild } from '../../../../../src/features/children/hooks';
import { RecordConsentForm } from '../../../../../src/features/consent/RecordConsentForm';
import { useTranslation } from '../../../../../src/localization';
import { apiErrorMessageKey } from '../../../../../src/services/api/errorMessages';

export default function RecordConsentScreen() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const { t } = useTranslation();
  const child = useChild(childId ?? '');
  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="record-consent-screen">
      {child.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : child.isError ? (
        <ErrorState message={t(apiErrorMessageKey(child.error))} onRetry={() => void child.refetch()} />
      ) : (
        <RecordConsentForm child={child.data} />
      )}
    </ScreenContainer>
  );
}
