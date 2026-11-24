import type { RegistrationAreasResponse } from '@balswasthya/shared-contracts';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppCard, AppIcon, AppText, StatusBadge } from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { colors, radius, spacing } from '../../../theme';

/**
 * Layout pieces of the child registration page (registration redesign, stage A): progress steps,
 * numbered section cards and the read-only area card. Display only - all rules stay in the form.
 */

export type StepState = 'done' | 'current' | 'upcoming';

export const REGISTRATION_STEPS: readonly TranslationKey[] = [
  'children.register.childSection',
  'children.register.guardianSection',
  'children.form.area',
  'children.register.steps.consent',
  'children.register.steps.screening',
];

const STATE_LABEL: Record<StepState, TranslationKey> = {
  done: 'children.register.steps.done',
  current: 'children.register.steps.current',
  upcoming: 'children.register.steps.upcoming',
};

/**
 * Wide screens: a vertical list beside the form. Phones: a compact row of numbered dots plus
 * "Step 2 of 5: ..." so it never takes much space above the form.
 */
export function RegistrationSteps({ states, vertical }: { states: StepState[]; vertical: boolean }) {
  const { t } = useTranslation();
  const currentIndex = Math.max(
    0,
    states.findIndex((s) => s === 'current'),
  );
  return (
    <View
      style={vertical ? styles.stepsVertical : styles.stepsRow}
      accessibilityRole="summary"
      accessibilityLabel={t('children.register.steps.label')}
      testID="registration-steps"
    >
      {vertical ? (
        <AppCard style={styles.stepsCard}>
          {REGISTRATION_STEPS.map((key, i) => (
            <View
              key={key}
              style={[styles.stepItem, states[i] === 'current' && styles.stepItemCurrent]}
              accessible
              accessibilityLabel={`${i + 1}. ${t(key)}: ${t(STATE_LABEL[states[i]!])}`}
              testID={`registration-step-${i + 1}-${states[i]}`}
            >
              <StepDot index={i} state={states[i]!} />
              <AppText variant={states[i] === 'current' ? 'bodyStrong' : 'body'} style={styles.flex}>
                {t(key)}
              </AppText>
            </View>
          ))}
        </AppCard>
      ) : (
        <>
          <View style={styles.dotRow}>
            {REGISTRATION_STEPS.map((key, i) => (
              <View
                key={key}
                style={styles.dotCell}
                accessible
                accessibilityLabel={`${i + 1}. ${t(key)}: ${t(STATE_LABEL[states[i]!])}`}
                testID={`registration-step-${i + 1}-${states[i]}`}
              >
                <StepDot index={i} state={states[i]!} />
                {i < REGISTRATION_STEPS.length - 1 ? (
                  <View style={[styles.connector, states[i] === 'done' && styles.connectorDone]} />
                ) : null}
              </View>
            ))}
          </View>
          <AppText variant="bodySmall" color="textSecondary">
            {t('children.register.steps.position', {
              current: currentIndex + 1,
              total: REGISTRATION_STEPS.length,
              name: t(REGISTRATION_STEPS[currentIndex]!),
            })}
          </AppText>
        </>
      )}
    </View>
  );
}

function StepDot({ index, state }: { index: number; state: StepState }) {
  return (
    <View style={[styles.dot, state === 'done' && styles.dotDone, state === 'current' && styles.dotCurrent]}>
      {state === 'done' ? (
        <AppIcon name="check" size="sm" color={colors.textOnPrimary} />
      ) : (
        <AppText variant="caption" color={state === 'current' ? 'textOnPrimary' : 'textSecondary'}>
          {String(index + 1)}
        </AppText>
      )}
    </View>
  );
}

/** "1. Child details" card with a "Complete" badge once its required fields are valid. */
export function FormSectionCard({
  number,
  title,
  subtitle,
  complete,
  aside,
  highlighted,
  children,
  testID,
}: {
  number: number;
  title: string;
  subtitle?: string;
  complete?: boolean;
  /** Small note on the right instead of the badge, e.g. "Pre-filled from your assignment". */
  aside?: ReactNode;
  highlighted?: boolean;
  children: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <AppCard style={[styles.section, highlighted && styles.sectionHighlighted]} testID={testID}>
      <View style={styles.sectionHeader}>
        <View style={styles.flex}>
          <AppText variant="subtitle" accessibilityRole="header">
            {`${number}. ${title}`}
          </AppText>
          {subtitle ? (
            <AppText variant="bodySmall" color="textSecondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {aside ??
          (complete ? <StatusBadge label={t('children.register.sectionComplete')} tone="success" /> : null)}
      </View>
      {children}
    </AppCard>
  );
}

type RegistrationArea = RegistrationAreasResponse['items'][number];

/** The worker's only area, shown as read-only facts (level: name, and the area above it). */
export function AreaFacts({ area, language }: { area: RegistrationArea; language: 'en' | 'hi' }) {
  const { t } = useTranslation();
  const name = language === 'hi' && area.nameHi ? area.nameHi : area.nameEn;
  const parent = language === 'hi' && area.parentNameHi ? area.parentNameHi : area.parentNameEn;
  return (
    <View style={styles.factGrid} testID="area-facts">
      <Fact label={language === 'hi' ? area.levelNameHi : area.levelNameEn} value={name} />
      {parent ? <Fact label={t('children.register.areaParent')} value={parent} /> : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

export function PrefilledNote() {
  const { t } = useTranslation();
  return (
    <View style={styles.prefilled}>
      <AppIcon name="lock-outline" size="sm" color={colors.textSecondary} />
      <AppText variant="caption" color="textSecondary">
        {t('children.register.areaPrefilled')}
      </AppText>
    </View>
  );
}

const DOT = 32;

const styles = StyleSheet.create({
  flex: { flex: 1, flexShrink: 1 },
  stepsRow: { gap: spacing.xs },
  stepsVertical: { width: 260 },
  stepsCard: { gap: spacing.xs, padding: spacing.sm },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  stepItemCurrent: { backgroundColor: colors.primarySurface },
  dotRow: { flexDirection: 'row', alignItems: 'center' },
  dotCell: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  connector: { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: spacing.xs },
  connectorDone: { backgroundColor: colors.secondary },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  dotDone: { backgroundColor: colors.secondaryStrong, borderColor: colors.secondaryStrong },
  dotCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  section: { gap: spacing.md },
  sectionHighlighted: { borderColor: colors.primary, borderWidth: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fact: {
    flexGrow: 1,
    flexBasis: 160,
    gap: spacing.xxs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  prefilled: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
