import { Alert, Screen } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';

/** Placeholder until the Parent Care content stages (8B-8F) add approved care plans. */
export default function CarePlanScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t('home.carePlan')} back testID="care-plan-screen">
      <Alert tone="info" message={t('soon.carePlan')} />
    </Screen>
  );
}
