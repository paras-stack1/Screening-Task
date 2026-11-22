import type { ScreeningQuestion } from '@balswasthya/shared-contracts';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppCard,
  AppIcon,
  AppInput,
  AppText,
  ChoiceGroup,
  StatusBadge,
} from '../../../components';
import { useTranslation, type TranslationKey } from '../../../localization';
import { colors, radius, spacing, touchTarget } from '../../../theme';
import { EMPTY_DRAFT, type AnswerDraft, type DraftError } from '../answerDraft';
import { localized } from '../labels';

type YesNoChoice = 'YES' | 'NO' | 'UNKNOWN' | 'NOT_ASSESSED' | 'UNABLE_TO_ASSESS';
type StateChoice = 'ANSWERED' | 'UNKNOWN' | 'NOT_ASSESSED' | 'UNABLE_TO_ASSESS';

export const DRAFT_ERROR_KEYS: Record<DraftError | 'server', TranslationKey> = {
  source: 'screening.question.errors.source',
  value: 'screening.question.errors.value',
  number: 'screening.question.errors.number',
  decimals: 'screening.question.errors.decimals',
  min: 'screening.question.errors.range',
  max: 'screening.question.errors.range',
  tooLong: 'screening.question.errors.tooLong',
  server: 'screening.question.errors.server',
};

interface QuestionFieldProps {
  question: ScreeningQuestion;
  draft: AnswerDraft;
  onChange: (draft: AnswerDraft) => void;
  error?: DraftError | 'server';
  readOnly?: boolean;
}

/**
 * One question. Every state is an explicit choice - nothing is preselected, "Unknown" and "Not
 * assessed" are separate from "No", and leaving a question untouched keeps it unanswered.
 */
export function QuestionField({ question, draft, onChange, error, readOnly = false }: QuestionFieldProps) {
  const { t, language } = useTranslation();
  const [showNotes, setShowNotes] = useState(draft.notes !== '');
  const set = (patch: Partial<AnswerDraft>) => onChange({ ...draft, ...patch });
  const id = `q-${question.code}`;
  const rules = question.validation;

  const stateOptions: { value: StateChoice; label: string }[] = [
    { value: 'ANSWERED', label: t('screening.question.state.ANSWERED') },
    { value: 'UNKNOWN', label: t('screening.question.state.UNKNOWN') },
    { value: 'NOT_ASSESSED', label: t('screening.question.state.NOT_ASSESSED') },
    { value: 'UNABLE_TO_ASSESS', label: t('screening.question.state.UNABLE_TO_ASSESS') },
  ];
  const yesNoOptions: { value: YesNoChoice; label: string }[] = [
    { value: 'YES', label: t('screening.question.yes') },
    { value: 'NO', label: t('screening.question.no') },
    ...stateOptions.slice(1).map((o) => ({ value: o.value as YesNoChoice, label: o.label })),
  ];
  const yesNoValue: YesNoChoice | '' =
    draft.status === 'ANSWERED' ? (draft.yesNo === null ? '' : draft.yesNo ? 'YES' : 'NO') : draft.status;

  return (
    <AppCard style={styles.card} testID={id}>
      <View style={styles.promptRow}>
        <AppText variant="bodyStrong" style={styles.prompt}>
          {localized(question.prompt, language)}
        </AppText>
        {question.isRequired ? <StatusBadge label={t('screening.question.required')} tone="neutral" /> : null}
      </View>
      {question.help ? (
        <AppText variant="bodySmall" color="textSecondary">
          {localized(question.help, language)}
        </AppText>
      ) : null}

      {question.answerType === 'YES_NO' ? (
        <ChoiceGroup
          label={t('screening.question.answer')}
          options={yesNoOptions}
          value={yesNoValue}
          disabled={readOnly}
          onChange={(choice) =>
            choice === 'YES' || choice === 'NO'
              ? set({ status: 'ANSWERED', yesNo: choice === 'YES' })
              : set({ status: choice, yesNo: null })
          }
          testID={`${id}-answer`}
        />
      ) : (
        <ChoiceGroup
          label={t('screening.question.answer')}
          options={stateOptions}
          value={draft.status}
          disabled={readOnly}
          onChange={(status) => set({ status })}
          testID={`${id}-state`}
        />
      )}

      {draft.status === 'ANSWERED' && question.answerType === 'NUMBER' ? (
        <AppInput
          label={t('screening.question.number')}
          hint={
            rules?.min !== undefined && rules.max !== undefined
              ? t('screening.question.numberRange', {
                  min: rules.min,
                  max: rules.max,
                  unit: rules.unit ?? '',
                })
              : undefined
          }
          value={draft.number}
          onChangeText={(number) => set({ number })}
          keyboardType="decimal-pad"
          editable={!readOnly}
          testID={`${id}-number`}
        />
      ) : null}
      {draft.status === 'ANSWERED' && question.answerType === 'TEXT' ? (
        <AppInput
          label={t('screening.question.text')}
          value={draft.text}
          onChangeText={(text) => set({ text })}
          multiline
          maxLength={rules?.maxLength ?? 1000}
          editable={!readOnly}
          testID={`${id}-text`}
        />
      ) : null}
      {draft.status === 'ANSWERED' && question.answerType === 'SINGLE_CHOICE' ? (
        <ChoiceGroup
          label={t('screening.question.chooseOne')}
          options={(question.options ?? []).map((o) => ({
            value: o.code,
            label: localized(o.label, language),
          }))}
          value={draft.choice}
          disabled={readOnly}
          onChange={(choice) => set({ choice })}
          testID={`${id}-choice`}
        />
      ) : null}
      {draft.status === 'ANSWERED' && question.answerType === 'MULTI_CHOICE' ? (
        <View style={styles.multi} accessibilityLabel={t('screening.question.chooseAny')}>
          <AppText variant="label">{t('screening.question.chooseAny')}</AppText>
          {(question.options ?? []).map((option) => {
            const checked = draft.choices.includes(option.code);
            return (
              <Pressable
                key={option.code}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: readOnly }}
                accessibilityLabel={localized(option.label, language)}
                disabled={readOnly}
                onPress={() =>
                  set({
                    choices: checked
                      ? draft.choices.filter((c) => c !== option.code)
                      : [...draft.choices, option.code],
                  })
                }
                style={[styles.checkbox, checked && styles.checked]}
                testID={`${id}-multi-${option.code}`}
              >
                <AppIcon
                  name={checked ? 'checkbox-marked-outline' : 'checkbox-blank-outline'}
                  color={checked ? colors.primary : colors.textSecondary}
                />
                <AppText variant="body">{localized(option.label, language)}</AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {draft.status === 'NOT_ASSESSED' || draft.status === 'UNABLE_TO_ASSESS' ? (
        <AppInput
          label={t('screening.question.reason')}
          value={draft.reason}
          onChangeText={(reason) => set({ reason })}
          maxLength={200}
          editable={!readOnly}
          testID={`${id}-reason`}
        />
      ) : null}

      {draft.status !== '' ? (
        <ChoiceGroup
          label={t('screening.question.source')}
          options={[
            { value: 'WORKER_OBSERVED', label: t('screening.question.sourceWorker') },
            { value: 'GUARDIAN_REPORTED', label: t('screening.question.sourceGuardian') },
          ]}
          value={draft.source}
          disabled={readOnly}
          onChange={(source) => set({ source })}
          testID={`${id}-source`}
        />
      ) : null}

      {draft.status !== '' && (showNotes || draft.notes !== '') ? (
        <AppInput
          label={t('screening.question.notes')}
          hint={t('screening.question.notesHint')}
          value={draft.notes}
          onChangeText={(notes) => set({ notes })}
          multiline
          maxLength={500}
          editable={!readOnly}
          testID={`${id}-notes`}
        />
      ) : null}

      {error ? (
        <AppText variant="bodySmall" color="danger" accessibilityRole="alert" testID={`${id}-error`}>
          {t(DRAFT_ERROR_KEYS[error])}
        </AppText>
      ) : null}

      {!readOnly && draft.status !== '' ? (
        <View style={styles.actions}>
          {!showNotes && draft.notes === '' ? (
            <AppButton
              variant="ghost"
              icon="note-plus-outline"
              label={t('screening.question.addNote')}
              onPress={() => setShowNotes(true)}
            />
          ) : null}
          <AppButton
            variant="ghost"
            icon="eraser"
            label={t('screening.question.clear')}
            onPress={() => {
              setShowNotes(false);
              onChange(EMPTY_DRAFT);
            }}
            testID={`${id}-clear`}
          />
        </View>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  promptRow: { gap: spacing.xs },
  prompt: { flexShrink: 1 },
  multi: { gap: spacing.xs },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.min,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  checked: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
