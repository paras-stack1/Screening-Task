import type { EffectiveAccess } from '@balswasthya/shared-contracts';
import { StyleSheet, View } from 'react-native';
import {
  AppCard,
  AppText,
  ErrorState,
  LoadingIndicator,
  ScreenContainer,
  SectionHeader,
  StatusBadge,
} from '../../src/components';
import { useAuthenticatedUser } from '../../src/features/auth/AuthProvider';
import { useMe } from '../../src/features/auth/hooks/useMe';
import { areaLevelName, roleName } from '../../src/features/profile/labels';
import { apiErrorMessageKey } from '../../src/services/api/errorMessages';
import { useTranslation } from '../../src/localization';
import { spacing } from '../../src/theme';

type Assignment = EffectiveAccess['assignments'][number];

/**
 * Profile (read-only). Shows name, account status and role/areas from GET /auth/me. Roles and
 * areas cannot be edited here - they are managed by administrators through the API.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const user = useAuthenticatedUser();
  const me = useMe();
  if (!user) return null;

  return (
    <ScreenContainer edges={['left', 'right']} testID="profile-screen">
      <AppCard>
        <AppText variant="label" color="textSecondary">
          {t('profile.nameLabel')}
        </AppText>
        <AppText variant="subtitle" accessibilityRole="header">
          {user.displayName}
        </AppText>
        <AppText variant="label" color="textSecondary">
          {t('profile.statusLabel')}
        </AppText>
        {/* GET /auth/me and every other call succeed only for ACTIVE accounts. */}
        <StatusBadge label={t('profile.statusActive')} tone="success" />
      </AppCard>

      <SectionHeader title={t('profile.assignmentsTitle')} subtitle={t('profile.managedNote')} />
      {me.data ? (
        // Loaded data stays visible even if a later background refresh fails.
        me.data.access.assignments.length === 0 ? (
          <AppCard>
            <AppText>{t('profile.noAssignments')}</AppText>
          </AppCard>
        ) : (
          me.data.access.assignments.map((assignment) => (
            <AssignmentCard key={assignment.assignmentId} assignment={assignment} />
          ))
        )
      ) : me.isError || me.fetchStatus === 'paused' ? (
        // Paused = offline before anything loaded: explain instead of spinning forever.
        <ErrorState
          message={t(me.isError ? apiErrorMessageKey(me.error) : 'errors.network')}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
        />
      ) : (
        <LoadingIndicator />
      )}
    </ScreenContainer>
  );
}

function AssignmentCard({ assignment }: { assignment: Assignment }) {
  const { t, language } = useTranslation();
  const area = language === 'hi' && assignment.areaNameHi ? assignment.areaNameHi : assignment.areaName;

  return (
    <AppCard testID="profile-assignment">
      <View style={styles.field}>
        <AppText variant="label" color="textSecondary">
          {t('profile.roleLabel')}
        </AppText>
        <AppText variant="bodyStrong">{roleName(t, assignment.roleCode)}</AppText>
      </View>
      <View style={styles.field}>
        <AppText variant="label" color="textSecondary">
          {t('profile.areaLabel')}
        </AppText>
        <AppText>
          {t('profile.areaWithLevel', { area, level: areaLevelName(t, assignment.areaLevel) })}
        </AppText>
        <AppText variant="bodySmall" color="textSecondary">
          {t(`profile.scope.${assignment.scope}`)}
        </AppText>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xxs },
});
