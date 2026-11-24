import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useChildren, useSelectedChild } from '../../src/children';
import { Alert, Avatar, Button, Card, formatDate, Loading, Screen, T, Tile } from '../../src/components/ui';
import { errorKey, useI18n } from '../../src/i18n';
import { useSession } from '../../src/session/SessionProvider';
import { colors, spacing } from '../../src/theme';

/** Parent dashboard (brief screen 8; mock-up): greeting, child card, four tiles, next check-up. */
export default function HomeScreen() {
  const { t, language } = useI18n();
  const router = useRouter();
  const { state } = useSession();
  const children = useChildren();
  const { child } = useSelectedChild(children.data);
  const name = state.status === 'signedIn' ? state.account.guardianName : '';

  return (
    <Screen title={t('app.name')} testID="home-screen">
      <View>
        <T variant="hero" color={colors.primary}>
          {t('home.greeting')}
        </T>
        <T variant="large">{`${t('home.welcome')}, ${name}`}</T>
      </View>

      {children.isPending ? <Loading label={t('common.loading')} /> : null}
      {children.isError ? (
        <>
          <Alert message={t(errorKey(children.error))} />
          <Button label={t('common.retry')} variant="secondary" onPress={() => void children.refetch()} />
        </>
      ) : null}
      {children.data && children.data.length === 0 ? (
        <Alert tone="info" message={t('home.noChildren')} testID="home-no-children" />
      ) : null}

      {child ? (
        <>
          <Card testID="child-card">
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
              <Avatar name={child.fullName} />
              <View style={{ flex: 1 }}>
                <T variant="large" testID="child-name">
                  {child.fullName}
                </T>
                <T variant="small">
                  {t(child.dobIsEstimated ? 'home.ageApprox' : 'home.age', {
                    years: child.ageYears,
                    months: child.ageMonths,
                  })}
                </T>
                <T variant="small">
                  {t('home.centre', {
                    centre: (language === 'hi' && child.centre.nameHi) || child.centre.nameEn,
                  })}
                </T>
              </View>
            </View>
            {children.data && children.data.length > 1 ? (
              <Button
                label={t('home.changeChild')}
                variant="ghost"
                icon="account-switch"
                onPress={() => router.push('/children')}
                testID="home-change-child"
              />
            ) : null}
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <Tile
              icon="clipboard-text-outline"
              label={t('home.carePlan')}
              badge={t('common.comingSoon')}
              onPress={() => router.push('/care-plan')}
              testID="tile-care-plan"
            />
            <Tile
              icon="play-circle-outline"
              label={t('home.videos')}
              badge={t('common.comingSoon')}
              onPress={() => router.push('/videos')}
              testID="tile-videos"
            />
            <Tile
              icon="calendar-check-outline"
              label={t('home.followUps')}
              onPress={() => router.push('/follow-ups')}
              testID="tile-follow-ups"
            />
            <Tile
              icon="account-heart-outline"
              label={t('home.assistance')}
              hint={t('home.assistanceHint')}
              onPress={() => router.push('/assistance')}
              testID="tile-assistance"
            />
          </View>

          <Card testID="next-check-up">
            <T variant="bodyStrong" color={colors.teal}>
              {t('home.nextCheckUp')}
            </T>
            <T variant="large">
              {child.nextCheckUp ? formatDate(child.nextCheckUp, language) : t('home.noCheckUp')}
            </T>
            {child.nextAppointment ? (
              <>
                <T variant="bodyStrong" color={colors.teal}>
                  {t('home.nextAppointment')}
                </T>
                <T>
                  {formatDate(child.nextAppointment.at, language)}
                  {child.nextAppointment.facilityName ? ` - ${child.nextAppointment.facilityName}` : ''}
                </T>
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      <Button
        label={t('home.settings')}
        variant="secondary"
        icon="shield-account-outline"
        onPress={() => router.push('/settings')}
        testID="home-settings"
      />
    </Screen>
  );
}
