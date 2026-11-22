import type { CategoryCompleteness, FourDCategoryCode } from '@balswasthya/shared-contracts';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppIcon,
  AppText,
  InlineAlert,
  StatusBadge,
  type IconName,
  type StatusTone,
} from '../../../components';
import { useTranslation, type TranslateFn, type TranslationKey } from '../../../localization';
import { fourDColors, radius, spacing } from '../../../theme';
import { CATEGORY_THEME, categoryDescriptionKey, categoryTitleKey } from '../labels';

const CATEGORY_ICONS: Record<FourDCategoryCode, IconName> = {
  DEFECTS_AT_BIRTH: 'baby-face-outline',
  DEFICIENCIES: 'food-apple-outline',
  DISEASES: 'virus-outline',
  DEVELOPMENTAL_DELAYS_DISABILITIES: 'human-child',
};

/**
 * Shown on every screening screen whose content is not clinically approved (decision F). Placed
 * first so it is read before any question.
 */
export function DemoContentBanner({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return <InlineAlert tone="warning" message={t('screening.demoBanner')} testID="screening-demo-banner" />;
}

/** "Screening observation recorded ... not a diagnosis" - shown wherever results could be read into. */
export function NotADiagnosisNote() {
  const { t } = useTranslation();
  return (
    <AppText variant="caption" color="textSecondary" testID="screening-not-diagnosis">
      {t('screening.notDiagnosis')}
    </AppText>
  );
}

/** Age with its uncertainty: an estimated date of birth is never presented as an exact age. */
export function screeningAgeText(
  t: TranslateFn,
  age: { years: number; months: number },
  dobIsEstimated: boolean,
): string {
  const text =
    age.years > 0
      ? t('children.age.yearsMonths', { years: age.years, months: age.months })
      : t('children.age.months', { months: age.months });
  return dobIsEstimated ? t('screening.age.approximate', { age: text }) : text;
}

export type CategoryState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_AVAILABLE';

/**
 * Workflow state only - never a health conclusion. "Completed" means the worker finished the
 * questions, so it is NOT shown in green (green would read as "healthy").
 */
const STATE_STYLE: Record<CategoryState, { tone: StatusTone; icon: IconName; label: TranslationKey }> = {
  NOT_STARTED: { tone: 'neutral', icon: 'circle-outline', label: 'screening.categoryState.NOT_STARTED' },
  IN_PROGRESS: { tone: 'warning', icon: 'progress-clock', label: 'screening.categoryState.IN_PROGRESS' },
  COMPLETED: { tone: 'info', icon: 'check-circle-outline', label: 'screening.categoryState.COMPLETED' },
  NOT_AVAILABLE: {
    tone: 'neutral',
    icon: 'minus-circle-outline',
    label: 'screening.categoryState.NOT_AVAILABLE',
  },
};

export function CategoryStateBadge({ state }: { state: CategoryState }) {
  const { t } = useTranslation();
  const style = STATE_STYLE[state];
  return <StatusBadge label={t(style.label)} tone={style.tone} icon={style.icon} />;
}

interface CategoryCardProps {
  category: FourDCategoryCode;
  state: CategoryState;
  completeness?: CategoryCompleteness;
  /** Why it is not available (translated), when state is NOT_AVAILABLE. */
  unavailableReason?: string;
  actionLabel?: string;
  onPress?: () => void;
  loading?: boolean;
}

export function CategoryCard({
  category,
  state,
  completeness,
  unavailableReason,
  actionLabel,
  onPress,
  loading,
}: CategoryCardProps) {
  const { t } = useTranslation();
  const tone = fourDColors[CATEGORY_THEME[category]];
  return (
    <AppCard accentColor={tone.accent} style={styles.card} testID={`category-card-${category}`}>
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: tone.surface }]}>
          <AppIcon name={CATEGORY_ICONS[category]} color={tone.accent} />
        </View>
        <View style={styles.titles}>
          <AppText variant="bodyStrong" style={{ color: tone.accent }}>
            {t(categoryTitleKey(category))}
          </AppText>
          <AppText variant="bodySmall" color="textSecondary">
            {t(categoryDescriptionKey(category))}
          </AppText>
        </View>
      </View>
      <CategoryStateBadge state={state} />
      {completeness && state !== 'NOT_STARTED' ? (
        <AppText variant="bodySmall" testID={`category-progress-${category}`}>
          {t('screening.category.progress', {
            addressed: completeness.totalQuestions - completeness.notAnswered,
            total: completeness.totalQuestions,
          })}
        </AppText>
      ) : null}
      {unavailableReason ? (
        <AppText variant="bodySmall" color="textSecondary">
          {unavailableReason}
        </AppText>
      ) : null}
      {onPress && actionLabel ? (
        <AppButton
          label={actionLabel}
          onPress={onPress}
          loading={loading}
          variant={state === 'NOT_STARTED' ? 'primary' : 'secondary'}
          testID={`category-action-${category}`}
        />
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  titles: { flex: 1, gap: spacing.xxs },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
