import { useChildDetail, useChildren, useSelectedChild } from '../../src/children';
import { Alert, Card, formatDate, Loading, Screen, T } from '../../src/components/ui';
import { errorKey, useI18n } from '../../src/i18n';
import { colors } from '../../src/theme';

/** Upcoming check-ups and doctor appointments of the selected child (dates only, PP12). */
export default function FollowUpsScreen() {
  const { t, language } = useI18n();
  const children = useChildren();
  const { child } = useSelectedChild(children.data);
  const detail = useChildDetail(child?.childId ?? null);
  return (
    <Screen title={t('followUps.title')} back testID="follow-ups-screen">
      {child ? <T variant="large">{child.fullName}</T> : null}
      {detail.isPending ? <Loading label={t('common.loading')} /> : null}
      {detail.isError ? <Alert message={t(errorKey(detail.error))} /> : null}
      {detail.data ? (
        <>
          <Card testID="check-ups">
            <T variant="bodyStrong" color={colors.teal}>
              {t('followUps.checkUps')}
            </T>
            {detail.data.upcomingCheckUps.length === 0 ? <T>{t('followUps.noneCheckUps')}</T> : null}
            {detail.data.upcomingCheckUps.map((d) => (
              <T key={d} variant="large">
                {formatDate(d, language)}
              </T>
            ))}
          </Card>
          <Card testID="appointments">
            <T variant="bodyStrong" color={colors.teal}>
              {t('followUps.appointments')}
            </T>
            {detail.data.upcomingAppointments.length === 0 ? <T>{t('followUps.noneAppointments')}</T> : null}
            {detail.data.upcomingAppointments.map((a) => (
              <T key={a.at}>
                {formatDate(a.at, language)}
                {a.facilityName ? ` ${t('followUps.at', { facility: a.facilityName })}` : ''}
              </T>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
