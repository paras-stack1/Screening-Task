import { AppCard, AppText, ScreenContainer } from '../../src/components';
import { useAuthenticatedUser } from '../../src/features/auth/AuthProvider';
import { DashboardHeader } from '../../src/features/dashboard/components/DashboardHeader';
import {
  ActionsSection,
  FourDSection,
  MetricsSection,
} from '../../src/features/dashboard/components/DashboardSections';
import { useTranslation } from '../../src/localization';
import { colors } from '../../src/theme';

/** Home dashboard. Shows only real data or clearly marked unavailable states. */
export default function DashboardScreen() {
  const { t } = useTranslation();
  const user = useAuthenticatedUser();
  if (!user) return null;

  return (
    <ScreenContainer edges={['left', 'right']} testID="dashboard-screen">
      <DashboardHeader displayName={user.displayName} />
      <MetricsSection />
      <ActionsSection />
      <FourDSection />
      <AppCard accentColor={colors.secondary}>
        <AppText variant="bodySmall">{t('app.screeningDisclaimer')}</AppText>
      </AppCard>
    </ScreenContainer>
  );
}
