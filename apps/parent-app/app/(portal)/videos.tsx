import { Alert, Screen } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';

/** Placeholder until the Parent Care content stages (8B-8F) add approved learning videos. */
export default function VideosScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t('home.videos')} back testID="videos-screen">
      <Alert tone="info" message={t('soon.videos')} />
    </Screen>
  );
}
