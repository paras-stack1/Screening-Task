import { EmptyState, ScreenContainer } from '../../src/components';
import { useTranslation } from '../../src/localization';

/** Decision I: the API has no notifications endpoint yet, so nothing is shown or invented. */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  return (
    <ScreenContainer edges={['left', 'right']} testID="notifications-screen">
      <EmptyState
        icon="bell-outline"
        title={t('notifications.empty.title')}
        message={t('notifications.empty.message')}
      />
    </ScreenContainer>
  );
}
