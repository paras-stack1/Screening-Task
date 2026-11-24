import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import {
  ActionCard,
  AppButton,
  AppText,
  FourDCategoryCard,
  MetricCard,
  SectionHeader,
  type IconName,
  type MetricState,
} from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { spacing, type FourDCategory } from '../../../theme';
import { useChildPermissions, useRecentChildren } from '../../children/hooks';
import { formatIndiaDate } from '../../children/labels';
import { childRoutes } from '../../children/routes';
import { useScreeningPermissions, useScreeningSummary } from '../../screening/hooks';
import { screeningRoutes } from '../../screening/routes';
import type { ReferralDashboard } from '@balswasthya/shared-contracts';
import { useReferralDashboard, useReferralPermissions } from '../../referrals/hooks';
import { referralRoutes } from '../../referrals/routes';
import { useRegisteredChildren } from '../hooks/useDashboardMetrics';

/**
 * Metrics. "Registered children" and (Step 6) "Screened today" come from the API. Step 7F: open
 * follow-ups and pending referrals (waiting for approval or for issue) come from
 * GET /dashboards/referrals over the user's areas - never invented; "not for your role" without
 * child.read.
 */
export function MetricsSection() {
  const { t } = useTranslation();
  const children = useRegisteredChildren();
  const screening = useScreeningPermissions();
  const summary = useScreeningSummary(screening.canConduct);
  const screenedToday: MetricState = !screening.loaded
    ? { status: 'loading' }
    : !screening.canConduct
      ? { status: 'unavailable' }
      : summary.isError || (summary.isPending && summary.fetchStatus === 'paused')
        ? { status: 'error' }
        : summary.isPending
          ? { status: 'loading' }
          : { status: 'ready', value: summary.data.completedToday };
  const referralPermissions = useReferralPermissions();
  const referralDashboard = useReferralDashboard(referralPermissions.canRead);
  const referralMetric = (pick: (d: ReferralDashboard) => number): MetricState =>
    !referralPermissions.loaded
      ? { status: 'loading' }
      : !referralPermissions.canRead
        ? { status: 'unavailable' }
        : referralDashboard.isError
          ? { status: 'error' }
          : referralDashboard.isPending
            ? { status: 'loading' }
            : { status: 'ready', value: pick(referralDashboard.data.dashboard) };
  const referralMetrics: { label: TranslationKey; icon: IconName; state: MetricState; testID: string }[] = [
    {
      label: 'dashboard.metrics.pendingFollowUps',
      icon: 'calendar-check-outline',
      state: referralMetric((d) => d.followUps.open),
      testID: 'metric-pending-follow-ups',
    },
    {
      label: 'dashboard.metrics.pendingReferrals',
      icon: 'hospital-building',
      state: referralMetric((d) => d.referrals.byStatus.PENDING_APPROVAL + d.referrals.byStatus.APPROVED),
      testID: 'metric-pending-referrals',
    },
  ];

  return (
    <View style={styles.section}>
      <SectionHeader title={t('dashboard.metrics.title')} />
      <View style={styles.grid}>
        <MetricCard
          label={t('dashboard.metrics.registeredChildren')}
          icon="account-child-outline"
          state={children.state}
          unavailableLabel={children.notForRole ? t('dashboard.metrics.notForRole') : undefined}
          testID="metric-registered-children"
        />
        <MetricCard
          label={t('dashboard.metrics.screenedToday')}
          icon="clipboard-pulse-outline"
          state={screenedToday}
          unavailableLabel={
            screening.loaded && !screening.canConduct ? t('dashboard.metrics.notForRole') : undefined
          }
          testID="metric-screened-today"
        />
        {referralMetrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={t(metric.label)}
            icon={metric.icon}
            state={metric.state}
            unavailableLabel={
              referralPermissions.loaded && !referralPermissions.canRead
                ? t('dashboard.metrics.notForRole')
                : undefined
            }
            testID={metric.testID}
          />
        ))}
      </View>
      {summary.isError ? (
        <AppButton
          variant="secondary"
          icon="sync"
          label={t('common.retry')}
          onPress={() => void summary.refetch()}
        />
      ) : null}
      {children.state.status === 'error' ? (
        <AppButton variant="secondary" icon="sync" label={t('common.retry')} onPress={children.retry} />
      ) : null}
    </View>
  );
}

/**
 * Main tasks. Register is available to workers with child.create (from /auth/me - a display
 * decision only; the API checks again). Screening (Step 6) needs screening.conduct. Step 7F:
 * referrals need child.read; follow-ups need follow_up.update or referral.update.
 */
export function ActionsSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useChildPermissions();
  const screening = useScreeningPermissions();
  const referrals = useReferralPermissions();
  const handlers: Record<string, (() => void) | undefined> = {
    register: permissions.canCreate ? () => router.push(childRoutes.register()) : undefined,
    screening: screening.canConduct ? () => router.push(screeningRoutes.home) : undefined,
    referrals: referrals.canRead ? () => router.push(referralRoutes.home) : undefined,
    followUps: referrals.canWorkFollowUps ? () => router.push(referralRoutes.followUps) : undefined,
  };
  const actions: { key: string; icon: IconName; title: TranslationKey; description: TranslationKey }[] = [
    {
      key: 'register',
      icon: 'account-plus-outline',
      title: 'dashboard.actions.registerChild.title',
      description: 'dashboard.actions.registerChild.description',
    },
    {
      key: 'screening',
      icon: 'stethoscope',
      title: 'dashboard.actions.startScreening.title',
      description: 'dashboard.actions.startScreening.description',
    },
    {
      key: 'referrals',
      icon: 'hospital-building',
      title: 'dashboard.actions.referrals.title',
      description: 'dashboard.actions.referrals.description',
    },
    {
      key: 'followUps',
      icon: 'calendar-check-outline',
      title: 'dashboard.actions.followUps.title',
      description: 'dashboard.actions.followUps.description',
    },
  ];

  return (
    <View style={styles.section}>
      <SectionHeader title={t('dashboard.actions.title')} />
      {actions.map((action) => (
        <ActionCard
          key={action.key}
          icon={action.icon}
          title={t(action.title)}
          description={t(action.description)}
          onPress={handlers[action.key]}
          unavailableLabel={permissions.loaded ? t('dashboard.metrics.notForRole') : t('common.loading')}
          testID={`action-${action.key}`}
        />
      ))}
    </View>
  );
}

const FOUR_D: FourDCategory[] = ['defectsAtBirth', 'deficiencies', 'diseases', 'developmentalDelays'];

/** RBSK 4-D overview: information only, no results. Texts pending expert review (decision U). */
export function FourDSection() {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <SectionHeader title={t('dashboard.fourD.title')} subtitle={t('dashboard.fourD.subtitle')} />
      <View style={styles.grid}>
        {FOUR_D.map((category) => (
          <FourDCategoryCard
            key={category}
            category={category}
            title={t(`fourD.${category}.title`)}
            description={t(`fourD.${category}.description`)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  // Two columns on phones; cards wrap to one column when text is large (minWidth on the cards).
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

/**
 * Five most recently registered children in the worker's areas (decision T). Real API data only
 * (GET /children sorted by registration time); hidden for roles without child.read.
 */
export function RecentChildrenSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useChildPermissions();
  const recent = useRecentChildren(permissions.canRead);
  if (!permissions.canRead) return null;

  return (
    <View style={styles.section} testID="recent-children">
      <SectionHeader title={t('dashboard.recent.title')} />
      {recent.isPending ? (
        <AppText color="textSecondary">{t('common.loading')}</AppText>
      ) : recent.isError ? (
        <AppButton
          variant="secondary"
          icon="sync"
          label={t('common.retry')}
          onPress={() => void recent.refetch()}
        />
      ) : recent.data.items.length === 0 ? (
        <AppText color="textSecondary">{t('dashboard.recent.empty')}</AppText>
      ) : (
        recent.data.items.map((child) => (
          <ActionCard
            key={child.id}
            icon="account-child-outline"
            title={child.fullName}
            description={t('dashboard.recent.registeredOn', { date: formatIndiaDate(child.registeredAt) })}
            onPress={() => router.push(childRoutes.profile(child.id))}
            testID={`recent-child-${child.id}`}
          />
        ))
      )}
    </View>
  );
}
