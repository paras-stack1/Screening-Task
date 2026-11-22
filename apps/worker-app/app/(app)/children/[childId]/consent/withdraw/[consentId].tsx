import { useLocalSearchParams } from 'expo-router';
import { EmptyState, ErrorState, LoadingIndicator, ScreenContainer } from '../../../../../../src/components';
import { useChild, useChildConsents } from '../../../../../../src/features/children/hooks';
import { WithdrawConsentForm } from '../../../../../../src/features/consent/WithdrawConsentForm';
import { useTranslation } from '../../../../../../src/localization';
import { apiErrorMessageKey } from '../../../../../../src/services/api/errorMessages';

/** The consent is looked up in THIS child's history - never loaded by id alone. */
export default function WithdrawConsentScreen() {
  const { childId, consentId } = useLocalSearchParams<{ childId: string; consentId: string }>();
  const { t } = useTranslation();
  const child = useChild(childId ?? '');
  const consents = useChildConsents(childId ?? '');
  const record = consents.data?.history.find((r) => r.id === consentId);
  const error = child.error ?? consents.error;

  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="withdraw-consent-screen">
      {child.isPending || consents.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : error ? (
        <ErrorState
          message={t(apiErrorMessageKey(error))}
          onRetry={() => {
            void child.refetch();
            void consents.refetch();
          }}
        />
      ) : !record || !child.data ? (
        <EmptyState icon="file-document-outline" title={t('consent.withdraw.notFound')} />
      ) : (
        <WithdrawConsentForm child={child.data} record={record} />
      )}
    </ScreenContainer>
  );
}
