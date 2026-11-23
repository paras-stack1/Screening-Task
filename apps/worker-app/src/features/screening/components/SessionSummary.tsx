import type {
  ScreeningMeasurementType,
  ScreeningProtocolDetail,
  ScreeningQuestion,
  ScreeningResponse,
  ScreeningSessionDetail,
} from '@balswasthya/shared-contracts';
import { StyleSheet, View } from 'react-native';
import { AppCard, AppText, InlineAlert, SectionHeader, StatusBadge } from '../../../components';
import { useTranslation, type TranslateFn, type TranslationKey } from '../../../localization';
import { spacing } from '../../../theme';
import { formatIndiaDate } from '../../children/labels';
import {
  categoryTitleKey,
  localized,
  MEASUREMENT_QUALITY_KEYS,
  MEASUREMENT_SOURCE_KEYS,
  MEASUREMENT_TYPE_KEYS,
} from '../labels';
import { DemoContentBanner, NotADiagnosisNote, screeningAgeText } from './ScreeningParts';

/** The recorded answer in plain words. Unknown / not assessed are shown as such, never as "No". */
export function answerText(
  t: TranslateFn,
  language: string,
  question: ScreeningQuestion,
  response: ScreeningResponse,
): string {
  if (response.status !== 'ANSWERED') {
    const state = t(`screening.question.state.${response.status}` as TranslationKey);
    return response.notAssessedReason ? `${state} – ${response.notAssessedReason}` : state;
  }
  const value = response.value;
  const option = (code: string) => {
    const found = question.options?.find((o) => o.code === code);
    return found ? localized(found.label, language) : code;
  };
  switch (question.answerType) {
    case 'YES_NO':
      return t(value ? 'screening.question.yes' : 'screening.question.no');
    case 'NUMBER':
      return question.validation?.unit ? `${String(value)} ${question.validation.unit}` : String(value);
    case 'SINGLE_CHOICE':
      return option(String(value));
    case 'MULTI_CHOICE':
      return (Array.isArray(value) ? value : []).map(option).join(', ');
    case 'TEXT':
      return String(value);
  }
}

const SOURCE_KEYS: Record<string, TranslationKey> = {
  WORKER_OBSERVED: 'screening.question.sourceWorker',
  GUARDIAN_REPORTED: 'screening.question.sourceGuardian',
};

interface SessionSummaryProps {
  session: ScreeningSessionDetail;
  /** Protocol versions used by the session's categories, by id (questions for the answers). */
  protocols: ReadonlyMap<string, ScreeningProtocolDetail>;
}

/**
 * What was recorded - observations only. There is no outcome, score or recommendation: no
 * approved screening rules exist (decision P), and the screen says so in plain words.
 */
export function SessionSummary({ session: s, protocols }: SessionSummaryProps) {
  const { t, language } = useTranslation();
  const statusKey = `screening.sessionStatus.${s.status}` as TranslationKey;
  const current = s.measurements.filter((m) => m.isCurrent);
  const corrected = s.measurements.length - current.length;

  return (
    <View style={styles.root} testID="session-summary">
      <DemoContentBanner visible={s.usesUnapprovedContent} />
      <AppCard style={styles.card}>
        <AppText variant="subtitle">{s.childName}</AppText>
        <AppText variant="body">{screeningAgeText(t, s.ageAtStart, s.dobEstimatedAtStart)}</AppText>
        <AppText variant="bodySmall" color="textSecondary">
          {t('screening.session.startedBy', { date: formatIndiaDate(s.startedAt), name: s.conductedByName })}
        </AppText>
        {s.completedAt ? (
          <AppText variant="bodySmall" color="textSecondary" testID="summary-completed-on">
            {t('screening.summary.completedOn', { date: formatIndiaDate(s.completedAt) })}
          </AppText>
        ) : null}
        <StatusBadge label={t(statusKey)} tone="neutral" />
        {s.status === 'CANCELLED' && s.cancelReason ? (
          <AppText variant="bodySmall" testID="summary-cancel-reason">
            {t('screening.summary.cancelledLine', { reason: s.cancelReason, name: s.cancelledByName ?? '' })}
          </AppText>
        ) : null}
      </AppCard>
      {s.dobEstimatedAtStart ? (
        <InlineAlert tone="info" message={t('screening.eligibility.estimatedDob')} />
      ) : null}

      <AppCard style={styles.card} testID="summary-outcome">
        <AppText variant="bodyStrong">{t('screening.summary.recordedTitle')}</AppText>
        <AppText variant="body">{t('screening.summary.noRules')}</AppText>
      </AppCard>

      <SectionHeader title={t('screening.summary.categoriesTitle')} />
      {s.sessionCategories.length === 0 ? (
        <AppText color="textSecondary">{t('screening.summary.noCategories')}</AppText>
      ) : null}
      {s.sessionCategories.map((c) => {
        const protocol = protocols.get(c.protocol.id);
        const questions = new Map(protocol?.questions.map((q) => [q.id, q]) ?? []);
        return (
          <AppCard key={c.id} style={styles.card} testID={`summary-category-${c.category}`}>
            <AppText variant="bodyStrong">{t(categoryTitleKey(c.category))}</AppText>
            <StatusBadge
              label={t(
                c.status === 'COMPLETED'
                  ? 'screening.categoryState.COMPLETED'
                  : 'screening.summary.incomplete',
              )}
              tone={c.status === 'COMPLETED' ? 'info' : 'warning'}
            />
            <AppText variant="bodySmall" testID={`summary-completeness-${c.category}`}>
              {t('screening.summary.completeness', {
                answered: c.completeness.answered,
                unknown: c.completeness.unknown,
                notAssessed: c.completeness.notAssessed,
                notAnswered: c.completeness.notAnswered,
              })}
            </AppText>
            {c.responses.map((r) => {
              const q = questions.get(r.questionId);
              return (
                <View
                  key={r.id}
                  style={styles.answer}
                  testID={`summary-answer-${c.category}-${r.questionCode}`}
                >
                  <AppText variant="bodySmall" color="textSecondary">
                    {q ? localized(q.prompt, language) : r.questionCode}
                  </AppText>
                  <AppText variant="body">{q ? answerText(t, language, q, r) : t('common.loading')}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {t(SOURCE_KEYS[r.source] ?? 'screening.question.source')}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </AppText>
                </View>
              );
            })}
            {c.notes ? (
              <AppText variant="bodySmall" testID={`summary-notes-${c.category}`}>
                {t('screening.summary.workerNotes', { notes: c.notes })}
              </AppText>
            ) : null}
          </AppCard>
        );
      })}
      {s.categoriesNotAssessed.length > 0 ? (
        <AppCard style={styles.card} testID="summary-not-assessed">
          <AppText variant="bodyStrong">{t('screening.summary.notAssessedTitle')}</AppText>
          {s.categoriesNotAssessed.map((c) => (
            <AppText key={c} variant="body">
              {t(categoryTitleKey(c))}
            </AppText>
          ))}
        </AppCard>
      ) : null}

      <SectionHeader title={t('screening.measurement.title')} />
      {current.length === 0 ? (
        <AppText color="textSecondary">{t('screening.measurement.none')}</AppText>
      ) : (
        current.map((m) => (
          <AppText key={m.id} variant="body" testID={`summary-measurement-${m.id}`}>
            {t('screening.summary.measurementLine', {
              type: t(
                MEASUREMENT_TYPE_KEYS[m.type as ScreeningMeasurementType] ?? 'screening.measurement.title',
              ),
              value: m.value,
              unit: m.unit,
              source: t(MEASUREMENT_SOURCE_KEYS[m.source as keyof typeof MEASUREMENT_SOURCE_KEYS]),
              quality: t(MEASUREMENT_QUALITY_KEYS[m.quality as keyof typeof MEASUREMENT_QUALITY_KEYS]),
            })}
          </AppText>
        ))
      )}
      {corrected > 0 ? (
        <AppText variant="caption" color="textSecondary">
          {t('screening.summary.correctedCount', { count: corrected })}
        </AppText>
      ) : null}
      <NotADiagnosisNote />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  card: { gap: spacing.sm },
  answer: { gap: spacing.xxs },
});
