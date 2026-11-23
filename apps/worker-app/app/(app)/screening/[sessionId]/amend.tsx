import {
  MEASUREMENT_QUALITIES,
  MEASUREMENT_SOURCES,
  type AmendmentChangeInput,
  type FourDCategoryCode,
  type MeasurementUnit,
  type ScreeningMeasurement,
  type ScreeningMeasurementType,
  type ScreeningQuestion,
  type ScreeningResponse,
} from '@balswasthya/shared-contracts';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppInput,
  AppText,
  ChoiceGroup,
  ConfirmationDialog,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
  StatusBadge,
} from '../../../../src/components';
import { formatIndiaDate } from '../../../../src/features/children/labels';
import {
  changeKey,
  isUnchanged,
  measurementEditFrom,
  reasonError,
  toChangeInput,
  type ChangeError,
  type MeasurementEdit,
  type PendingChange,
} from '../../../../src/features/screening/amendDraft';
import {
  draftFromResponse,
  sectionsOf,
  type AnswerDraft,
} from '../../../../src/features/screening/answerDraft';
import { answerText } from '../../../../src/features/screening/answerText';
import { DRAFT_ERROR_KEYS, QuestionField } from '../../../../src/features/screening/components/QuestionField';
import {
  DemoContentBanner,
  NotADiagnosisNote,
} from '../../../../src/features/screening/components/ScreeningParts';
import { sessionErrorKey } from '../../../../src/features/screening/errors';
import {
  useApplySessionUpdate,
  useRefetchSession,
  useScreeningApi,
  useSessionWithProtocols,
} from '../../../../src/features/screening/hooks';
import {
  categoryTitleKey,
  localized,
  MEASUREMENT_QUALITY_KEYS,
  MEASUREMENT_SOURCE_KEYS,
  MEASUREMENT_TYPE_KEYS,
} from '../../../../src/features/screening/labels';
import {
  MEASUREMENT_MAX_DECIMALS,
  MEASUREMENT_UNITS,
} from '../../../../src/features/screening/measurementRules';
import { screeningRoutes } from '../../../../src/features/screening/routes';
import { useTranslation, type TranslationKey } from '../../../../src/localization';
import { apiErrorMessageKey } from '../../../../src/services/api/errorMessages';
import { isApiError } from '../../../../src/services/api/errors';
import { spacing } from '../../../../src/theme';
import { newSubmissionId } from '../../../../src/utils/submissionId';

const MEASUREMENT_ERROR_KEYS: Record<string, TranslationKey> = {
  unit: 'screening.measurement.errors.unit',
  value: 'screening.measurement.errors.value',
  decimals: 'screening.measurement.errors.decimals',
  source: 'screening.measurement.errors.source',
  quality: 'screening.measurement.errors.quality',
  date: 'screening.measurement.errors.date',
  dateFuture: 'screening.measurement.errors.dateFuture',
  dateBeforeBirth: 'screening.measurement.errors.beforeBirth',
};

function changeErrorKey(error: ChangeError): TranslationKey {
  switch (error.kind) {
    case 'answer':
      return error.error === 'cleared' ? 'screening.amend.cleared' : DRAFT_ERROR_KEYS[error.error];
    case 'measurement':
      return MEASUREMENT_ERROR_KEYS[error.error] ?? 'screening.measurement.errors.value';
    case 'notes':
      return 'screening.amend.errors.notesTooLong';
  }
}

/**
 * Amend a COMPLETED screening (Step 6G-2, docs/step-6/amendment-design.md section 6).
 *
 * The worker chooses what to change (answers, measurements, area observations), gives a
 * mandatory reason and confirms. Everything is sent as ONE amendment = one new version; the
 * original record is never changed and the API stores the old values itself. Edits live only in
 * memory until saved. Starting a new area is not possible here (that needs a new screening).
 */
export default function AmendScreeningScreen() {
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
  const { t, language } = useTranslation();
  const router = useRouter();
  const api = useScreeningApi();
  const apply = useApplySessionUpdate();
  const refetch = useRefetchSession(sessionId);
  const { session, protocols, isError, error, retry } = useSessionWithProtocols(sessionId);

  const [changes, setChanges] = useState<Record<string, PendingChange>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, ChangeError>>({});
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState<'required' | 'tooLong' | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [confirming, setConfirming] = useState<AmendmentChangeInput[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const inFlight = useRef(false);
  const submission = useRef<{ id: string; key: string } | null>(null);

  const realChanges = Object.values(changes).filter((c) => !isUnchanged(c));
  const dirty = realChanges.length > 0 || reason.trim() !== '';
  usePreventRemove(dirty && !leaving, ({ repeat }) => setPendingLeave(() => repeat));

  if (isError) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-amend">
        <ErrorState message={t(apiErrorMessageKey(error))} onRetry={retry} />
      </ScreenContainer>
    );
  }
  if (!session) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-amend">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  if (session.status !== 'COMPLETED' || !session.canAmend) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-amend">
        <InlineAlert tone="info" message={t('screening.amend.cannotAmend')} testID="amend-not-allowed" />
        <AppButton
          variant="secondary"
          label={t('screening.summary.title')}
          onPress={() => router.replace(screeningRoutes.summary(session.id))}
        />
      </ScreenContainer>
    );
  }
  const s = session;

  const put = (change: PendingChange) => {
    setChanges((current) => ({ ...current, [change.key]: change }));
    setErrors(({ [change.key]: _removed, ...rest }) => rest);
    setMessage(null);
  };
  const undo = (key: string) => {
    setChanges(({ [key]: _removed, ...rest }) => rest);
    setErrors(({ [key]: _removed, ...rest }) => rest);
    setEditing((open) => (open === key ? null : open));
  };

  const prepare = () => {
    setMessage(null);
    const problem = reasonError(reason);
    setReasonProblem(problem);
    if (realChanges.length === 0) {
      setMessage('screening.amend.noChanges');
      return;
    }
    const inputs: AmendmentChangeInput[] = [];
    const found: Record<string, ChangeError> = {};
    for (const change of realChanges) {
      const result = toChangeInput(change, s.dateOfBirthAtStart, new Date());
      if (result.ok) inputs.push(result.input);
      else found[change.key] = result.error;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setMessage('screening.amend.errors.fixChanges');
      return;
    }
    if (problem) return;
    setConfirming(inputs);
  };

  const save = async (inputs: AmendmentChangeInput[]) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const content = { expectedSequence: s.amendments.length, reason: reason.trim(), changes: inputs };
    // The same content keeps the same operation id, so a retry after a lost response is safe.
    const key = JSON.stringify(content);
    if (submission.current?.key !== key) submission.current = { id: newSubmissionId(), key };
    try {
      const response = await api.amend(s.id, { clientOperationId: submission.current.id, ...content });
      apply(response);
      setLeaving(true);
      setConfirming(null);
      router.replace(screeningRoutes.summaryAfterAmendment(s.id));
    } catch (err) {
      setConfirming(null);
      if (isApiError(err) && err.code === 'AMENDMENT_CONFLICT') {
        // Someone else amended meanwhile: reload; the worker's edits stay on screen.
        submission.current = null;
        void refetch();
      }
      setMessage(sessionErrorKey(err));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const categories = [...s.sessionCategories];

  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="screening-amend">
      <DemoContentBanner visible={s.usesUnapprovedContent} />
      <AppText variant="subtitle">{s.childName}</AppText>
      <AppText variant="body">{t('screening.amend.intro')}</AppText>

      {categories.map((c) => {
        const protocol = protocols.get(c.protocol.id);
        const questions = protocol ? sectionsOf(protocol.questions).flat() : [];
        const saved = new Map(c.responses.map((r) => [r.questionId, r]));
        const notesKey = changeKey.notes(c.category);
        const notesChange = changes[notesKey];
        return (
          <View key={c.id} style={styles.section} testID={`amend-category-${c.category}`}>
            <SectionHeader title={t(categoryTitleKey(c.category))} />
            {!protocol ? <LoadingIndicator label={t('common.loading')} /> : null}
            {questions.map((q) => (
              <ResponseRow
                key={q.id}
                category={c.category}
                question={q}
                saved={saved.get(q.id)}
                change={changes[changeKey.response(c.category, q.id)]}
                open={editing === changeKey.response(c.category, q.id)}
                error={errors[changeKey.response(c.category, q.id)]}
                onOpen={() => setEditing(changeKey.response(c.category, q.id))}
                onChange={put}
                onUndo={undo}
                language={language}
              />
            ))}
            <AppCard style={styles.card} testID={`amend-notes-${c.category}`}>
              <AppText variant="bodyStrong">{t('screening.amend.notesTitle')}</AppText>
              <AppText variant="body">{c.notes ?? t('screening.amend.noNotes')}</AppText>
              {notesChange?.kind === 'CATEGORY_NOTES' || editing === notesKey ? (
                <>
                  <AppInput
                    label={t('screening.amend.notesLabel')}
                    value={notesChange?.kind === 'CATEGORY_NOTES' ? notesChange.notes : (c.notes ?? '')}
                    onChangeText={(notes) =>
                      put({
                        kind: 'CATEGORY_NOTES',
                        key: notesKey,
                        category: c.category,
                        before: c.notes,
                        notes,
                      })
                    }
                    maxLength={500}
                    multiline
                    error={errors[notesKey] ? t(changeErrorKey(errors[notesKey])) : undefined}
                    testID={`amend-notes-input-${c.category}`}
                  />
                  <AppButton
                    variant="ghost"
                    label={t('screening.amend.undo')}
                    onPress={() => undo(notesKey)}
                  />
                </>
              ) : (
                <AppButton
                  variant="ghost"
                  icon="pencil-outline"
                  label={t('screening.amend.change')}
                  accessibilityHint={t('screening.amend.changeItem', {
                    item: t('screening.amend.notesTitle'),
                  })}
                  onPress={() => setEditing(notesKey)}
                  testID={`amend-notes-change-${c.category}`}
                />
              )}
            </AppCard>
          </View>
        );
      })}

      {s.measurements.some((m) => m.isCurrent) ? (
        <View style={styles.section}>
          <SectionHeader title={t('screening.amend.measurementsTitle')} />
          {s.measurements
            .filter((m) => m.isCurrent)
            .map((m) => (
              <MeasurementRow
                key={m.id}
                measurement={m}
                change={changes[changeKey.measurement(m.id)]}
                open={editing === changeKey.measurement(m.id)}
                error={errors[changeKey.measurement(m.id)]}
                onOpen={() => setEditing(changeKey.measurement(m.id))}
                onChange={put}
                onUndo={undo}
              />
            ))}
        </View>
      ) : null}

      <SectionHeader title={t('screening.amend.save')} />
      <AppText variant="bodySmall" testID="amend-pending-count">
        {t('screening.amend.pendingCount', { count: realChanges.length })}
      </AppText>
      <AppInput
        label={t('screening.amend.reasonLabel')}
        hint={t('screening.amend.reasonHint')}
        value={reason}
        onChangeText={(text) => {
          setReason(text);
          setReasonProblem(null);
        }}
        maxLength={500}
        multiline
        error={
          reasonProblem === 'required'
            ? t('screening.amend.errors.reasonRequired')
            : reasonProblem === 'tooLong'
              ? t('screening.amend.errors.reasonTooLong')
              : undefined
        }
        testID="amend-reason"
      />
      {message ? <InlineAlert tone="danger" message={t(message)} testID="amend-message" /> : null}
      <PrimaryButton
        icon="content-save-outline"
        label={t('screening.amend.save')}
        onPress={prepare}
        loading={saving}
        testID="amend-save"
      />
      <NotADiagnosisNote />

      <ConfirmationDialog
        visible={confirming !== null}
        title={t('screening.amend.confirmTitle')}
        message={t('screening.amend.confirmMessage', {
          count: confirming?.length ?? 0,
          version: s.currentVersion + 1,
        })}
        confirmLabel={t('screening.amend.save')}
        cancelLabel={t('common.cancel')}
        confirming={saving}
        onConfirm={() => confirming && void save(confirming)}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmationDialog
        visible={pendingLeave !== null && !leaving}
        title={t('screening.amend.leaveTitle')}
        message={t('screening.amend.leaveMessage')}
        confirmLabel={t('screening.amend.leaveConfirm')}
        cancelLabel={t('screening.amend.leaveCancel')}
        destructive
        onConfirm={() => {
          setLeaving(true);
          pendingLeave?.();
        }}
        onCancel={() => setPendingLeave(null)}
      />
    </ScreenContainer>
  );
}

function ResponseRow({
  category,
  question,
  saved,
  change,
  open,
  error,
  onOpen,
  onChange,
  onUndo,
  language,
}: {
  category: FourDCategoryCode;
  question: ScreeningQuestion;
  saved: ScreeningResponse | undefined;
  change: PendingChange | undefined;
  open: boolean;
  error: ChangeError | undefined;
  onOpen: () => void;
  onChange: (change: PendingChange) => void;
  onUndo: (key: string) => void;
  language: string;
}) {
  const { t } = useTranslation();
  const key = changeKey.response(category, question.id);
  const draft: AnswerDraft = change?.kind === 'RESPONSE' ? change.draft : draftFromResponse(question, saved);
  const prompt = localized(question.prompt, language);
  return (
    <AppCard style={styles.card} testID={`amend-question-${category}-${question.code}`}>
      <AppText variant="bodySmall" color="textSecondary">
        {prompt}
      </AppText>
      <AppText variant="body">
        {saved ? answerText(t, language, question, saved) : t('screening.amend.notAnswered')}
      </AppText>
      {saved?.amended ? (
        <StatusBadge label={t('screening.amended')} tone="info" icon="pencil-outline" />
      ) : null}
      {open || change ? (
        <>
          <QuestionField
            question={question}
            draft={draft}
            onChange={(next) =>
              onChange({ kind: 'RESPONSE', key, category, question, before: saved, draft: next })
            }
            error={error?.kind === 'answer' && error.error !== 'cleared' ? error.error : undefined}
          />
          {error?.kind === 'answer' && error.error === 'cleared' ? (
            <AppText variant="bodySmall" color="danger" accessibilityRole="alert">
              {t('screening.amend.cleared')}
            </AppText>
          ) : null}
          <AppButton
            variant="ghost"
            label={t('screening.amend.undo')}
            onPress={() => onUndo(key)}
            testID={`amend-undo-${category}-${question.code}`}
          />
        </>
      ) : (
        <AppButton
          variant="ghost"
          icon="pencil-outline"
          label={t('screening.amend.change')}
          accessibilityHint={t('screening.amend.changeItem', { item: prompt })}
          onPress={onOpen}
          testID={`amend-change-${category}-${question.code}`}
        />
      )}
    </AppCard>
  );
}

function MeasurementRow({
  measurement: m,
  change,
  open,
  error,
  onOpen,
  onChange,
  onUndo,
}: {
  measurement: ScreeningMeasurement;
  change: PendingChange | undefined;
  open: boolean;
  error: ChangeError | undefined;
  onOpen: () => void;
  onChange: (change: PendingChange) => void;
  onUndo: (key: string) => void;
}) {
  const { t } = useTranslation();
  const key = changeKey.measurement(m.id);
  const type = m.type as ScreeningMeasurementType;
  const edit: MeasurementEdit = change?.kind === 'MEASUREMENT' ? change.edit : measurementEditFrom(m);
  const set = (patch: Partial<MeasurementEdit>) =>
    onChange({ kind: 'MEASUREMENT', key, measurement: m, edit: { ...edit, ...patch } });
  const title = t(MEASUREMENT_TYPE_KEYS[type] ?? 'screening.measurement.title');
  return (
    <AppCard style={styles.card} testID={`amend-measurement-${m.id}`}>
      <AppText variant="bodyStrong">{title}</AppText>
      <AppText variant="body">
        {t('screening.measurement.meta', {
          source: t(MEASUREMENT_SOURCE_KEYS[m.source as keyof typeof MEASUREMENT_SOURCE_KEYS]),
          quality: t(MEASUREMENT_QUALITY_KEYS[m.quality as keyof typeof MEASUREMENT_QUALITY_KEYS]),
          date: formatIndiaDate(m.measuredAt),
          name: m.recordedByName,
        })}
      </AppText>
      <AppText variant="body">{t('screening.measurement.value', { value: m.value, unit: m.unit })}</AppText>
      {open || change ? (
        <>
          <ChoiceGroup
            label={t('screening.measurement.unitLabel')}
            options={MEASUREMENT_UNITS[type].map((unit) => ({ value: unit, label: unit }))}
            value={edit.unit}
            onChange={(unit: MeasurementUnit) => set({ unit })}
            testID={`amend-measurement-unit-${m.id}`}
          />
          <AppInput
            label={t('screening.measurement.valueLabel')}
            hint={
              edit.unit
                ? t('screening.measurement.valueHint', { decimals: MEASUREMENT_MAX_DECIMALS[edit.unit] })
                : undefined
            }
            value={edit.value}
            onChangeText={(value) => set({ value })}
            keyboardType="decimal-pad"
            testID={`amend-measurement-value-${m.id}`}
          />
          <ChoiceGroup
            label={t('screening.measurement.sourceLabel')}
            options={MEASUREMENT_SOURCES.map((value) => ({
              value,
              label: t(MEASUREMENT_SOURCE_KEYS[value]),
            }))}
            value={edit.source}
            onChange={(source) => set({ source })}
            testID={`amend-measurement-source-${m.id}`}
          />
          {edit.source && edit.source !== 'MEASURED' ? (
            <View style={styles.dateBlock}>
              <AppText variant="label">{t('screening.measurement.dateLabel')}</AppText>
              <AppText variant="caption" color="textSecondary">
                {t('screening.amend.measurementDateHint')}
              </AppText>
              <View style={styles.dateRow}>
                {(['day', 'month', 'year'] as const).map((part) => (
                  <View key={part} style={part === 'year' ? styles.dateWide : styles.dateNarrow}>
                    <AppInput
                      label={t(`children.form.${part}`)}
                      value={edit[part]}
                      onChangeText={(text) => set({ [part]: text.replace(/\D/g, '') })}
                      keyboardType="number-pad"
                      maxLength={part === 'year' ? 4 : 2}
                      placeholder={t(`children.form.${part}Placeholder`)}
                      testID={`amend-measurement-date-${part}-${m.id}`}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          <ChoiceGroup
            label={t('screening.measurement.qualityLabel')}
            options={MEASUREMENT_QUALITIES.map((value) => ({
              value,
              label: t(MEASUREMENT_QUALITY_KEYS[value]),
            }))}
            value={edit.quality}
            onChange={(quality) => set({ quality })}
            testID={`amend-measurement-quality-${m.id}`}
          />
          {error?.kind === 'measurement' ? (
            <AppText
              variant="bodySmall"
              color="danger"
              accessibilityRole="alert"
              testID={`amend-measurement-error-${m.id}`}
            >
              {t(changeErrorKey(error))}
            </AppText>
          ) : null}
          <AppButton variant="ghost" label={t('screening.amend.undo')} onPress={() => onUndo(key)} />
        </>
      ) : (
        <AppButton
          variant="ghost"
          icon="pencil-outline"
          label={t('screening.amend.change')}
          accessibilityHint={t('screening.amend.changeItem', { item: title })}
          onPress={onOpen}
          testID={`amend-measurement-change-${m.id}`}
        />
      )}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  card: { gap: spacing.xs },
  dateBlock: { gap: spacing.xs },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  dateNarrow: { flex: 1 },
  dateWide: { flex: 1.6 },
});
