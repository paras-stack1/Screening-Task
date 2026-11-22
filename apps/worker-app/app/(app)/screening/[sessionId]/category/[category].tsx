import { fourDCategorySchema, type ScreeningQuestion } from '@balswasthya/shared-contracts';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppText,
  ConfirmationDialog,
  ErrorState,
  InlineAlert,
  LoadingIndicator,
  PrimaryButton,
  ScreenContainer,
  SectionHeader,
} from '../../../../../src/components';
import {
  EMPTY_DRAFT,
  draftFromResponse,
  isSameDraft,
  sectionPayload,
  sectionsOf,
  type AnswerDraft,
  type DraftError,
} from '../../../../../src/features/screening/answerDraft';
import { QuestionField } from '../../../../../src/features/screening/components/QuestionField';
import {
  CategoryStateBadge,
  DemoContentBanner,
  NotADiagnosisNote,
} from '../../../../../src/features/screening/components/ScreeningParts';
import { isVersionConflict, sessionErrorKey } from '../../../../../src/features/screening/errors';
import {
  useApplySessionUpdate,
  useRefetchSession,
  useScreeningApi,
  useScreeningProtocol,
  useScreeningSession,
} from '../../../../../src/features/screening/hooks';
import { categoryTitleKey } from '../../../../../src/features/screening/labels';
import { useTranslation, type TranslationKey } from '../../../../../src/localization';
import { apiErrorMessageKey } from '../../../../../src/services/api/errorMessages';
import { isApiError } from '../../../../../src/services/api/errors';
import { spacing } from '../../../../../src/theme';

type FieldErrors = Record<string, DraftError | 'server'>;

/**
 * One Four-D category, one section at a time (decision G). Answers live in memory until saved;
 * moving between sections keeps them; only changed answers are sent; leaving with unsaved
 * answers asks first. The API validates every answer again and decides the category can finish.
 */
export default function ScreeningCategoryScreen() {
  const params = useLocalSearchParams<{ sessionId: string; category: string }>();
  const sessionId = params.sessionId ?? '';
  const parsed = fourDCategorySchema.safeParse(params.category);
  const category = parsed.success ? parsed.data : null;
  const { t } = useTranslation();
  const router = useRouter();
  const api = useScreeningApi();
  const apply = useApplySessionUpdate();
  const refetchSession = useRefetchSession(sessionId);
  const session = useScreeningSession(sessionId);
  const sc = session.data?.sessionCategories.find((c) => c.category === category);
  const protocol = useScreeningProtocol(sc?.protocol.id);

  /** Only the questions the worker touched; everything else shows what the server has. */
  const [edited, setEdited] = useState<Record<string, AnswerDraft>>({});
  const [sectionIndex, setSectionIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ key: TranslationKey; tone: 'danger' | 'info' } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const questions = useMemo(() => protocol.data?.questions ?? [], [protocol.data]);
  const sections = useMemo(() => sectionsOf(questions), [questions]);
  const saved = useMemo(() => new Map((sc?.responses ?? []).map((r) => [r.questionId, r])), [sc?.responses]);

  // Worker's edits win; untouched questions follow the server (also after a reload).
  const drafts = useMemo(
    () =>
      Object.fromEntries(questions.map((q) => [q.id, edited[q.id] ?? draftFromResponse(q, saved.get(q.id))])),
    [questions, edited, saved],
  );
  const dirty = questions.some(
    (q) => !isSameDraft(q, drafts[q.id] ?? EMPTY_DRAFT, draftFromResponse(q, saved.get(q.id))),
  );

  usePreventRemove(dirty && !discarding, ({ repeat }) => setPendingLeave(() => repeat));

  if (!category) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-category">
        <ErrorState message={t('screening.session.notFound')} />
      </ScreenContainer>
    );
  }
  if (session.isError || protocol.isError) {
    const error = session.error ?? protocol.error;
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-category">
        <ErrorState
          message={t(apiErrorMessageKey(error))}
          onRetry={() => {
            void session.refetch();
            void protocol.refetch();
          }}
        />
      </ScreenContainer>
    );
  }
  if (session.isPending || (sc && protocol.isPending)) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-category">
        <LoadingIndicator label={t('common.loading')} />
      </ScreenContainer>
    );
  }
  const s = session.data;
  if (!sc) {
    return (
      <ScreenContainer edges={['left', 'right']} testID="screening-category">
        <ErrorState message={t('screening.category.notStarted')} />
      </ScreenContainer>
    );
  }

  const readOnly = !s.canEdit || sc.status === 'COMPLETED';
  const index = Math.min(sectionIndex, sections.length - 1);
  const section = sections[index] ?? [];
  const isLast = index === sections.length - 1;
  const addressed = questions.filter((q) => (drafts[q.id] ?? EMPTY_DRAFT).status !== '').length;

  const setDraft = (questionId: string, draft: AnswerDraft) => {
    setEdited((current) => ({ ...current, [questionId]: draft }));
    setFieldErrors((current) => {
      const { [questionId]: _removed, ...rest } = current;
      return rest;
    });
  };

  /** Saves the given questions' changes. Returns the session version afterwards, or null on failure. */
  const save = async (target: readonly ScreeningQuestion[]): Promise<number | null> => {
    const payload = sectionPayload(target, drafts, saved);
    if (Object.keys(payload.errors).length > 0) {
      setFieldErrors(payload.errors);
      const firstBad = sections.findIndex((sec) => sec.some((q) => payload.errors[q.id]));
      if (firstBad >= 0) setSectionIndex(firstBad);
      setMessage({ key: 'screening.category.fixErrors', tone: 'danger' });
      return null;
    }
    if (payload.responses.length === 0 && payload.cleared.length === 0) return s.version;
    try {
      const response = await api.saveResponses(s.id, category, {
        expectedVersion: s.version,
        responses: payload.responses,
        cleared: payload.cleared,
      });
      apply(response);
      setFieldErrors({});
      return response.session.version;
    } catch (err) {
      const code = isApiError(err)
        ? (err.details as { questionCode?: string } | undefined)?.questionCode
        : undefined;
      const question = code ? questions.find((q) => q.code === code) : undefined;
      if (question) setFieldErrors({ [question.id]: 'server' });
      if (isVersionConflict(err)) void refetchSession();
      setMessage({ key: sessionErrorKey(err), tone: 'danger' });
      return null;
    }
  };

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const saveAndContinue = () =>
    run(async () => {
      if ((await save(section)) !== null) setSectionIndex(index + 1);
    });

  const saveOnly = () =>
    run(async () => {
      if ((await save(questions)) !== null) setMessage({ key: 'screening.category.saved', tone: 'info' });
    });

  const finish = () =>
    run(async () => {
      const version = await save(questions);
      if (version === null) return;
      const missing = questions.filter((q) => q.isRequired && (drafts[q.id] ?? EMPTY_DRAFT).status === '');
      if (missing.length > 0) {
        setFieldErrors(Object.fromEntries(missing.map((q) => [q.id, 'value' as const])));
        setSectionIndex(sections.findIndex((sec) => sec.some((q) => q.id === missing[0]!.id)));
        setMessage({ key: 'screening.errors.requiredMissing', tone: 'danger' });
        return;
      }
      try {
        apply(await api.updateCategory(s.id, category, { expectedVersion: version, status: 'COMPLETED' }));
        router.back();
      } catch (err) {
        if (isVersionConflict(err)) void refetchSession();
        setMessage({ key: sessionErrorKey(err), tone: 'danger' });
      }
    });

  const reopen = () =>
    run(async () => {
      try {
        apply(
          await api.updateCategory(s.id, category, { expectedVersion: s.version, status: 'IN_PROGRESS' }),
        );
      } catch (err) {
        if (isVersionConflict(err)) void refetchSession();
        setMessage({ key: sessionErrorKey(err), tone: 'danger' });
      }
    });

  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="screening-category">
      <DemoContentBanner visible={!sc.usedApprovedContent} />
      <SectionHeader
        title={t(categoryTitleKey(category))}
        subtitle={t('screening.category.sectionOf', { current: index + 1, total: sections.length })}
      />
      <CategoryStateBadge state={sc.status} />
      <AppText variant="bodySmall" color="textSecondary" testID="category-addressed">
        {t('screening.category.progress', { addressed, total: questions.length })}
      </AppText>
      {readOnly ? (
        <InlineAlert
          tone="info"
          message={t(!s.canEdit ? 'screening.session.readOnly' : 'screening.category.completedLocked')}
          testID="category-read-only"
        />
      ) : null}
      {message ? (
        <InlineAlert tone={message.tone} message={t(message.key)} testID="category-message" />
      ) : null}

      <View style={styles.questions}>
        {section.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            draft={drafts[question.id] ?? EMPTY_DRAFT}
            onChange={(draft) => setDraft(question.id, draft)}
            error={fieldErrors[question.id]}
            readOnly={readOnly}
          />
        ))}
      </View>

      <View style={styles.actions}>
        {index > 0 ? (
          <AppButton
            variant="secondary"
            icon="chevron-left"
            label={t('screening.category.previous')}
            onPress={() => setSectionIndex(index - 1)}
            disabled={busy}
            testID="category-previous"
          />
        ) : null}
        {!isLast ? (
          <PrimaryButton
            icon="chevron-right"
            label={t(readOnly ? 'screening.category.next' : 'screening.category.saveAndContinue')}
            onPress={() => (readOnly ? setSectionIndex(index + 1) : void saveAndContinue())}
            loading={busy}
            testID="category-next"
          />
        ) : null}
        {!readOnly ? (
          <AppButton
            variant="secondary"
            icon="content-save-outline"
            label={t('screening.category.save')}
            onPress={() => void saveOnly()}
            disabled={busy || !dirty}
            testID="category-save"
          />
        ) : null}
        {!readOnly && isLast ? (
          <PrimaryButton
            icon="check"
            label={t('screening.category.finish')}
            onPress={() => void finish()}
            loading={busy}
            testID="category-finish"
          />
        ) : null}
        {s.canEdit && sc.status === 'COMPLETED' ? (
          <AppButton
            variant="secondary"
            icon="pencil-outline"
            label={t('screening.category.reopen')}
            onPress={() => void reopen()}
            loading={busy}
            testID="category-reopen"
          />
        ) : null}
      </View>
      <NotADiagnosisNote />

      <ConfirmationDialog
        visible={pendingLeave !== null && !discarding}
        title={t('screening.category.leaveTitle')}
        message={t('screening.category.leaveMessage')}
        confirmLabel={t('screening.category.leaveConfirm')}
        cancelLabel={t('screening.category.leaveCancel')}
        destructive
        onConfirm={() => {
          // repeat() lifts the protection itself and continues the blocked navigation.
          setDiscarding(true);
          pendingLeave?.();
        }}
        onCancel={() => setPendingLeave(null)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  questions: { gap: spacing.md },
  actions: { gap: spacing.sm },
});
