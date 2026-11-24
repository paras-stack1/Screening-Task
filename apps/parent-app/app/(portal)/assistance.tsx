import { useChildren, useSelectedChild } from '../../src/children';
import { Alert, Card, Screen, T } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';
import { colors } from '../../src/theme';

/** Get assistance: the child's health worker and centre. No phone numbers are shown (PP16). */
export default function AssistanceScreen() {
  const { t, language } = useI18n();
  const children = useChildren();
  const { child } = useSelectedChild(children.data);
  return (
    <Screen title={t('assist.title')} back testID="assistance-screen">
      <T>{t('assist.intro')}</T>
      {child ? (
        <Card testID="assist-card">
          <T variant="small" color={colors.textSecondary}>
            {t('assist.worker')}
          </T>
          <T variant="large" testID="assist-worker">
            {child.workerName ?? t('assist.noWorker')}
          </T>
          <T variant="small" color={colors.textSecondary}>
            {t('assist.centre')}
          </T>
          <T variant="large">{(language === 'hi' && child.centre.nameHi) || child.centre.nameEn}</T>
          <T>{t('assist.howTo')}</T>
        </Card>
      ) : null}
      <Alert tone="warning" message={t('assist.emergency')} />
    </Screen>
  );
}
