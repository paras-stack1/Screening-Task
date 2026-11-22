import type {
  ObservationStatus,
  ResponseInput,
  ScreeningQuestion,
  ScreeningResponse,
} from '@balswasthya/shared-contracts';

/**
 * Local, in-memory state of one answer while the worker fills a section (never stored on the
 * device). Missing data stays missing: a question with `status: ''` has no answer and is sent as
 * "cleared" (if it had one) - it is never turned into "No".
 *
 * Client checks here are for usability only; the API validates every answer again.
 */
export type Source = 'WORKER_OBSERVED' | 'GUARDIAN_REPORTED';

export interface AnswerDraft {
  status: ObservationStatus | '';
  yesNo: boolean | null;
  number: string;
  text: string;
  choice: string;
  choices: string[];
  source: Source | '';
  notes: string;
  reason: string;
}

export type DraftError = 'source' | 'value' | 'number' | 'decimals' | 'min' | 'max' | 'tooLong';

export const EMPTY_DRAFT: AnswerDraft = {
  status: '',
  yesNo: null,
  number: '',
  text: '',
  choice: '',
  choices: [],
  source: '',
  notes: '',
  reason: '',
};

export function draftFromResponse(question: ScreeningQuestion, response?: ScreeningResponse): AnswerDraft {
  if (!response) return EMPTY_DRAFT;
  const value = response.value;
  return {
    status: response.status,
    yesNo: question.answerType === 'YES_NO' && typeof value === 'boolean' ? value : null,
    number: question.answerType === 'NUMBER' && typeof value === 'number' ? String(value) : '',
    text: question.answerType === 'TEXT' && typeof value === 'string' ? value : '',
    choice: question.answerType === 'SINGLE_CHOICE' && typeof value === 'string' ? value : '',
    choices: question.answerType === 'MULTI_CHOICE' && Array.isArray(value) ? value : [],
    source: response.source,
    notes: response.notes ?? '',
    reason: response.notAssessedReason ?? '',
  };
}

/** Only the parts that matter for the answer's type and state (stale fields are ignored). */
function normalise(question: ScreeningQuestion, d: AnswerDraft) {
  const answered = d.status === 'ANSWERED';
  const notAssessed = d.status === 'NOT_ASSESSED' || d.status === 'UNABLE_TO_ASSESS';
  return {
    status: d.status,
    value: !answered
      ? null
      : question.answerType === 'YES_NO'
        ? d.yesNo
        : question.answerType === 'NUMBER'
          ? d.number.trim()
          : question.answerType === 'TEXT'
            ? d.text.trim()
            : question.answerType === 'SINGLE_CHOICE'
              ? d.choice
              : [...d.choices],
    source: d.status === '' ? '' : d.source,
    notes: d.status === '' ? '' : d.notes.trim(),
    reason: notAssessed ? d.reason.trim() : '',
  };
}

export function isSameDraft(question: ScreeningQuestion, a: AnswerDraft, b: AnswerDraft): boolean {
  return JSON.stringify(normalise(question, a)) === JSON.stringify(normalise(question, b));
}

const NUMBER = /^-?\d+(\.\d+)?$/;
/** The database keeps 3 decimals for answer numbers. */
const MAX_NUMBER_DECIMALS = 3;

export function validateDraft(question: ScreeningQuestion, d: AnswerDraft): DraftError | null {
  if (d.status === '') return null;
  if (d.source === '') return 'source';
  if (d.status !== 'ANSWERED') return null;
  const rules = question.validation ?? {};
  switch (question.answerType) {
    case 'YES_NO':
      return d.yesNo === null ? 'value' : null;
    case 'NUMBER': {
      const raw = d.number.trim();
      if (raw === '') return 'value';
      if (!NUMBER.test(raw)) return 'number';
      const decimals = raw.includes('.') ? raw.split('.')[1]!.length : 0;
      if (decimals > Math.min(rules.maxDecimals ?? MAX_NUMBER_DECIMALS, MAX_NUMBER_DECIMALS))
        return 'decimals';
      const value = Number(raw);
      if (rules.min !== undefined && value < rules.min) return 'min';
      if (rules.max !== undefined && value > rules.max) return 'max';
      return null;
    }
    case 'TEXT':
      if (d.text.trim() === '') return 'value';
      return d.text.trim().length > (rules.maxLength ?? 1000) ? 'tooLong' : null;
    case 'SINGLE_CHOICE':
      return d.choice === '' ? 'value' : null;
    case 'MULTI_CHOICE':
      return d.choices.length === 0 ? 'value' : null;
  }
}

export function toResponseInput(question: ScreeningQuestion, d: AnswerDraft): ResponseInput {
  const n = normalise(question, d);
  const value =
    n.value === null
      ? undefined
      : question.answerType === 'NUMBER'
        ? Number(n.value as string)
        : (n.value as ResponseInput['value']);
  return {
    questionId: question.id,
    status: d.status as ObservationStatus,
    source: d.source as Source,
    ...(value !== undefined ? { value } : {}),
    ...(n.reason ? { notAssessedReason: n.reason } : {}),
    ...(n.notes ? { notes: n.notes } : {}),
  };
}

export interface SectionPayload {
  responses: ResponseInput[];
  cleared: string[];
  errors: Record<string, DraftError>;
}

/** What to send for one section: only changed answers; blanks that had an answer are cleared. */
export function sectionPayload(
  questions: readonly ScreeningQuestion[],
  drafts: Readonly<Record<string, AnswerDraft>>,
  saved: ReadonlyMap<string, ScreeningResponse>,
): SectionPayload {
  const payload: SectionPayload = { responses: [], cleared: [], errors: {} };
  for (const question of questions) {
    const draft = drafts[question.id] ?? EMPTY_DRAFT;
    const before = draftFromResponse(question, saved.get(question.id));
    if (isSameDraft(question, draft, before)) continue;
    if (draft.status === '') {
      if (saved.has(question.id)) payload.cleared.push(question.id);
      continue;
    }
    const error = validateDraft(question, draft);
    if (error) payload.errors[question.id] = error;
    else payload.responses.push(toResponseInput(question, draft));
  }
  return payload;
}

/** Questions grouped by section, in protocol order. */
export function sectionsOf(questions: readonly ScreeningQuestion[]): ScreeningQuestion[][] {
  const ordered = [...questions].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const sections: ScreeningQuestion[][] = [];
  for (const q of ordered) {
    const last = sections[sections.length - 1];
    if (last && last[0]!.sectionCode === q.sectionCode) last.push(q);
    else sections.push([q]);
  }
  return sections;
}
