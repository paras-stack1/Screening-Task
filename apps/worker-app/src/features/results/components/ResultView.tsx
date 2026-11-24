import type { CategoryResult, ResultOutcome, ResultRun } from '@balswasthya/shared-contracts';
import { StyleSheet, View } from 'react-native';
import { AppCard, AppText, InlineAlert, StatusBadge, type StatusTone } from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { spacing } from '../../../theme';
import { formatIndiaDateTime } from '../../children/labels';
import { categoryTitleKey, localized } from '../../screening/labels';

/** Badge tone per outcome. Concern = warning/danger; gaps = neutral; never "success" (no all-clear). */
export const OUTCOME_TONE: Record<ResultOutcome, StatusTone> = {
  URGENT_EVALUATION_RECOMMENDED: 'danger',
  FURTHER_EVALUATION_RECOMMENDED: 'warning',
  UNABLE_TO_DETERMINE: 'neutral',
  INCOMPLETE: 'neutral',
  NOT_INTERPRETED: 'neutral',
  NOT_ASSESSED: 'neutral',
  NO_CONCERN_IN_COMPLETED_ITEMS: 'info',
};
export const outcomeKey = (o: ResultOutcome) => `results.outcome.${o}` as TranslationKey;

/**
 * One screening result (Step 7 decision E). It keeps four things apart, as required:
 *  1. recorded observations (the screening summary - not repeated here),
 *  2. the automated screening interpretation (this card's outcomes and rules),
 *  3. the clinician's review (status / decision only),
 *  4. a confirmed diagnosis - which this app never records (said explicitly).
 */
export function ResultView({ run }: { run: ResultRun }) {
  const { t } = useTranslation();
  return (
    <View style={styles.stack} testID="result-view">
      <InlineAlert tone="info" message={t('results.notDiagnosis')} testID="result-not-diagnosis" />
      {run.usesUnapprovedContent ? (
        <InlineAlert tone="warning" message={t('results.unapproved')} testID="result-unapproved" />
      ) : null}
      {!run.isCurrent ? (
        <InlineAlert tone="warning" message={t('results.superseded')} testID="result-superseded" />
      ) : null}

      <AppCard style={styles.card}>
        <AppText variant="label" color="textSecondary">
          {t('results.layer.interpretation')}
        </AppText>
        <View style={styles.row}>
          <AppText variant="bodyStrong">{t('results.overall')}</AppText>
          <StatusBadge label={t(outcomeKey(run.overallOutcome))} tone={OUTCOME_TONE[run.overallOutcome]} />
        </View>
        <AppText variant="caption" color="textSecondary" testID="result-meta">
          {t('results.meta', {
            version: run.screeningVersion,
            date: formatIndiaDateTime(run.generatedAt),
            engine: run.engineVersion,
          })}
        </AppText>
      </AppCard>

      <AppCard style={styles.card} testID="result-review">
        <AppText variant="label" color="textSecondary">
          {t('results.layer.review')}
        </AppText>
        <AppText variant="body">
          {run.review
            ? t(`results.reviewStatus.${run.review.status}` as TranslationKey)
            : t('results.reviewStatus.none')}
        </AppText>
        {run.review?.decision ? (
          <AppText variant="bodySmall" color="textSecondary">
            {t(`results.decision.${run.review.decision}` as TranslationKey)}
          </AppText>
        ) : null}
      </AppCard>

      {run.categories.map((c) => (
        <CategoryResultCard key={c.id} result={c} />
      ))}

      <AppCard style={styles.card}>
        <AppText variant="label" color="textSecondary">
          {t('results.layer.diagnosis')}
        </AppText>
        <AppText variant="body">{t('results.noDiagnosisRecorded')}</AppText>
      </AppCard>
    </View>
  );
}

function CategoryResultCard({ result }: { result: CategoryResult }) {
  const { t, language } = useTranslation();
  return (
    <AppCard style={styles.card} testID={`result-category-${result.category}`}>
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {t(categoryTitleKey(result.category))}
        </AppText>
        <StatusBadge label={t(outcomeKey(result.outcome))} tone={OUTCOME_TONE[result.outcome]} />
      </View>
      <AppText variant="bodySmall" color="textSecondary">
        {t(`results.explain.${result.outcome}` as TranslationKey)}
      </AppText>
      {result.ruleSet ? (
        <AppText variant="caption" color="textSecondary">
          {t('results.ruleSet', {
            code: result.ruleSet.code,
            version: result.ruleSet.version,
            status: t(
              result.ruleSet.isOperational ? 'results.ruleSetApproved' : 'results.ruleSetNotApproved',
            ),
          })}
        </AppText>
      ) : null}
      {result.protocol ? (
        <AppText variant="caption" color="textSecondary">
          {t('results.protocol', { code: result.protocol.code, version: result.protocol.version })}
        </AppText>
      ) : null}
      {result.referralRecommended ? (
        <AppText variant="bodySmall" testID={`result-referral-${result.category}`}>
          {t('results.referralRecommended', {
            priority: result.suggestedPriority
              ? t(`results.priority.${result.suggestedPriority}` as TranslationKey)
              : '-',
          })}
        </AppText>
      ) : null}
      {result.rules.map((r) => (
        <AppText key={r.ruleId} variant="caption" testID={`result-rule-${result.category}-${r.ruleId}`}>
          {t('results.ruleLine', {
            name: localized(r.name, language),
            result: t(`results.ruleResult.${r.result}` as TranslationKey),
          })}
        </AppText>
      ))}
      {result.limitations.length > 0 ? (
        <View style={styles.limits}>
          {dedupe(result.limitations.map((l) => l.code)).map((code) => (
            <AppText key={code} variant="caption" color="textSecondary">
              {'• '}
              {t(`results.limitation.${code}` as TranslationKey)}
            </AppText>
          ))}
        </View>
      ) : null}
    </AppCard>
  );
}

const dedupe = (codes: string[]) => [...new Set(codes)];

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  limits: { gap: spacing.xxs, marginTop: spacing.xs },
});
