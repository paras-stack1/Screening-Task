import type {
  AmendmentChange,
  ScreeningAmendment,
  ScreeningMeasurementType,
  ScreeningProtocolDetail,
  ScreeningQuestion,
  ScreeningSessionDetail,
} from '@balswasthya/shared-contracts';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  InlineAlert,
  SectionHeader,
  StatusBadge,
} from '../../../components';
import { useTranslation, type TranslateFn, type TranslationKey } from '../../../localization';
import { spacing } from '../../../theme';
import { formatIndiaDate } from '../../children/labels';
import { sessionErrorKey } from '../errors';
import { useApplySessionUpdate, useScreeningApi } from '../hooks';
import {
  categoryTitleKey,
  localized,
  MEASUREMENT_QUALITY_KEYS,
  MEASUREMENT_SOURCE_KEYS,
  MEASUREMENT_TYPE_KEYS,
} from '../labels';
import { answerText } from '../answerText';

type Value = Record<string, unknown> | null;

/** One side (old or new) of a change in plain words. "None" stays visible, never hidden. */
export function changeValueText(
  t: TranslateFn,
  language: string,
  change: AmendmentChange,
  value: Value,
  question: ScreeningQuestion | undefined,
): string {
  if (value === null) {
    return t(change.kind === 'RESPONSE' ? 'screening.amendments.notAnswered' : 'screening.amendments.none');
  }
  switch (change.kind) {
    case 'RESPONSE': {
      const record = {
        status: value.status as 'ANSWERED' | 'UNKNOWN' | 'NOT_ASSESSED' | 'UNABLE_TO_ASSESS',
        value: (value.value ?? null) as never,
        notAssessedReason: (value.notAssessedReason as string | null) ?? null,
      };
      if (!question) return record.status;
      return answerText(t, language, question, record);
    }
    case 'MEASUREMENT': {
      const source = MEASUREMENT_SOURCE_KEYS[value.source as keyof typeof MEASUREMENT_SOURCE_KEYS];
      const quality = MEASUREMENT_QUALITY_KEYS[value.quality as keyof typeof MEASUREMENT_QUALITY_KEYS];
      return t('screening.amendments.measurementValue', {
        value: String(value.value),
        unit: String(value.unit),
        source: source ? t(source) : String(value.source),
        quality: quality ? t(quality) : String(value.quality),
        date: formatIndiaDate(String(value.measuredAt)),
      });
    }
    case 'CATEGORY_NOTES':
      return typeof value.notes === 'string' && value.notes !== ''
        ? value.notes
        : t('screening.amendments.none');
  }
}

function changeItemText(
  t: TranslateFn,
  language: string,
  change: AmendmentChange,
  question: ScreeningQuestion | undefined,
  measurementType: string | undefined,
): string {
  switch (change.kind) {
    case 'RESPONSE':
      return question ? localized(question.prompt, language) : (change.questionCode ?? '');
    case 'MEASUREMENT':
      return t(
        MEASUREMENT_TYPE_KEYS[measurementType as ScreeningMeasurementType] ?? 'screening.measurement.title',
      );
    case 'CATEGORY_NOTES':
      return t('screening.amendments.notesItem', {
        category: change.category ? t(categoryTitleKey(change.category)) : '',
      });
  }
}

/**
 * Every amendment of a completed screening, newest first: who, when, why, each change as
 * "old -> new", and the medical officer review status (decision G6). Medical officers can mark a
 * pending amendment as reviewed here (optional notes, explicit confirmation).
 */
export function AmendmentHistory({
  session,
  protocols,
}: {
  session: ScreeningSessionDetail;
  protocols: ReadonlyMap<string, ScreeningProtocolDetail>;
}) {
  const { t, language } = useTranslation();
  if (session.amendments.length === 0) return null;
  const questions = new Map<string, ScreeningQuestion>();
  for (const p of protocols.values()) for (const q of p.questions) questions.set(q.id, q);
  const measurementTypes = new Map(session.measurements.map((m) => [m.id, m.type]));
  const newestFirst = [...session.amendments].sort((a, b) => b.sequence - a.sequence);

  return (
    <View style={styles.root} testID="amendment-history">
      <SectionHeader title={t('screening.amendments.title')} />
      <AppText variant="bodySmall" color="textSecondary" testID="amendment-current-version">
        {t('screening.amendments.currentVersion', {
          version: session.currentVersion,
          count: session.amendments.length,
        })}
      </AppText>
      {newestFirst.map((a) => (
        <AppCard key={a.id} style={styles.card} testID={`amendment-${a.sequence}`}>
          <AppText variant="bodyStrong">
            {t('screening.amendments.version', {
              version: a.version,
              date: formatIndiaDate(a.amendedAt),
              name: a.amendedByName,
            })}
          </AppText>
          <AppText variant="bodySmall" color="textSecondary">
            {t(`screening.amendments.basis.${a.basis}` as TranslationKey)}
          </AppText>
          <AppText variant="body">{t('screening.amendments.reason', { reason: a.reason })}</AppText>
          {a.changes.map((c, index) => {
            const question = c.questionId ? questions.get(c.questionId) : undefined;
            return (
              <AppText key={index} variant="bodySmall" testID={`amendment-${a.sequence}-change-${index}`}>
                {t('screening.amendments.change', {
                  item: changeItemText(
                    t,
                    language,
                    c,
                    question,
                    c.measurementId ? measurementTypes.get(c.measurementId) : undefined,
                  ),
                  old: changeValueText(t, language, c, c.oldValue, question),
                  new: changeValueText(t, language, c, c.newValue, question),
                })}
              </AppText>
            );
          })}
          <ReviewStatus amendment={a} />
          {a.referralsFlagged > 0 ? (
            <InlineAlert
              tone="warning"
              message={t('screening.amendments.referrals', { count: a.referralsFlagged })}
            />
          ) : null}
          {a.reviewStatus === 'PENDING' && session.canReviewAmendments ? (
            <ReviewAction sessionId={session.id} amendment={a} />
          ) : null}
        </AppCard>
      ))}
    </View>
  );
}

function ReviewStatus({ amendment: a }: { amendment: ScreeningAmendment }) {
  const { t } = useTranslation();
  if (a.reviewStatus === 'REVIEWED') {
    return (
      <View style={styles.review} testID={`amendment-${a.sequence}-review`}>
        <StatusBadge
          tone="success"
          label={t('screening.amendments.review.REVIEWED', {
            name: a.reviewedByName ?? '',
            date: a.reviewedAt ? formatIndiaDate(a.reviewedAt) : '',
          })}
        />
        {a.selfReviewed ? (
          <AppText variant="caption" color="textSecondary">
            {t('screening.amendments.selfReviewed')}
          </AppText>
        ) : null}
        {a.reviewNotes ? (
          <AppText variant="bodySmall">
            {t('screening.amendments.reviewNotes', { notes: a.reviewNotes })}
          </AppText>
        ) : null}
      </View>
    );
  }
  return (
    <View testID={`amendment-${a.sequence}-review`}>
      <StatusBadge
        tone={a.reviewStatus === 'PENDING' ? 'warning' : 'neutral'}
        label={t(`screening.amendments.review.${a.reviewStatus}` as TranslationKey)}
      />
    </View>
  );
}

function ReviewAction({ sessionId, amendment }: { sessionId: string; amendment: ScreeningAmendment }) {
  const { t } = useTranslation();
  const api = useScreeningApi();
  const apply = useApplySessionUpdate();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  if (!open) {
    return (
      <AppButton
        variant="secondary"
        icon="check-decagram-outline"
        label={t('screening.amendments.markReviewed')}
        onPress={() => setOpen(true)}
        testID={`amendment-${amendment.sequence}-mark-reviewed`}
      />
    );
  }
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      apply(await api.reviewAmendment(sessionId, amendment.id, notes.trim() || undefined));
    } catch (err) {
      setError(sessionErrorKey(err));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <View style={styles.review}>
      {error ? <InlineAlert tone="danger" message={t(error)} /> : null}
      <AppInput
        label={t('screening.amendments.reviewNotesLabel')}
        value={notes}
        onChangeText={setNotes}
        maxLength={500}
        multiline
        testID={`amendment-${amendment.sequence}-review-notes`}
      />
      <AppButton
        label={t('screening.amendments.reviewConfirm')}
        onPress={() => void confirm()}
        loading={saving}
        testID={`amendment-${amendment.sequence}-review-confirm`}
      />
      <AppButton variant="ghost" label={t('common.cancel')} onPress={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  card: { gap: spacing.xs },
  review: { gap: spacing.xs },
});
