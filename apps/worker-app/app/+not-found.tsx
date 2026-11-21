import { router } from 'expo-router';
import { EmptyState, ScreenContainer } from '../src/components';
import { useTranslation } from '../src/localization';

/** Unknown routes and stale deep links. "Home" goes to the anchor, which the guards resolve. */
export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <ScreenContainer testID="not-found">
      <EmptyState
        icon="alert-circle-outline"
        title={t('notFound.title')}
        message={t('notFound.message')}
        action={{ label: t('notFound.goHome'), onPress: () => router.replace('/') }}
      />
    </ScreenContainer>
  );
}
