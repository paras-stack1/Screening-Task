import type { ScreeningQuestion, ScreeningResponse } from '@balswasthya/shared-contracts';
import {
  draftFromResponse,
  EMPTY_DRAFT,
  isSameDraft,
  sectionPayload,
  sectionsOf,
  toResponseInput,
  validateDraft,
  type AnswerDraft,
} from '../../src/features/screening/answerDraft';

/** Step 6D: answer drafts - missing stays missing, unknown is never "No", only changes are sent. */
let n = 0;
function question(overrides: Partial<ScreeningQuestion> = {}): ScreeningQuestion {
  n += 1;
  return {
    id: `q${n}`,
    code: `Q${n}`,
    sectionCode: 'S1',
    sortOrder: n,
    prompt: { hi: 'प्र', en: 'Q' },
    help: null,
    answerType: 'YES_NO',
    options: null,
    validation: null,
    isRequired: true,
    ...overrides,
  };
}
const draft = (patch: Partial<AnswerDraft>): AnswerDraft => ({ ...EMPTY_DRAFT, ...patch });
function response(q: ScreeningQuestion, patch: Partial<ScreeningResponse>): ScreeningResponse {
  return {
    id: `r-${q.id}`,
    questionId: q.id,
    questionCode: q.code,
    status: 'ANSWERED',
    source: 'WORKER_OBSERVED',
    value: true,
    notAssessedReason: null,
    notes: null,
    recordedAt: '2026-11-21T09:00:00.000Z',
    updatedAt: '2026-11-21T09:00:00.000Z',
    recordedByName: 'Sunita Devi',
    ...patch,
  };
}

describe('answer drafts', () => {
  it('sends YES / NO as booleans and UNKNOWN / NOT_ASSESSED without any value', () => {
    const q = question();
    expect(
      toResponseInput(q, draft({ status: 'ANSWERED', yesNo: false, source: 'WORKER_OBSERVED' })),
    ).toEqual({
      questionId: q.id,
      status: 'ANSWERED',
      source: 'WORKER_OBSERVED',
      value: false,
    });
    for (const status of ['UNKNOWN', 'NOT_ASSESSED', 'UNABLE_TO_ASSESS'] as const) {
      const input = toResponseInput(q, draft({ status, yesNo: false, source: 'GUARDIAN_REPORTED' }));
      expect(input).not.toHaveProperty('value');
      expect(input.status).toBe(status);
    }
  });

  it('keeps a reason only for not assessed / unable to assess', () => {
    const q = question();
    expect(
      toResponseInput(q, draft({ status: 'NOT_ASSESSED', source: 'WORKER_OBSERVED', reason: ' asleep ' }))
        .notAssessedReason,
    ).toBe('asleep');
    expect(
      toResponseInput(q, draft({ status: 'UNKNOWN', source: 'WORKER_OBSERVED', reason: 'stale' })),
    ).not.toHaveProperty('notAssessedReason');
  });

  it('converts a typed number and validates range and decimals', () => {
    const q = question({ answerType: 'NUMBER', validation: { min: 0, max: 30, maxDecimals: 1 } });
    const d = (number: string) => draft({ status: 'ANSWERED', number, source: 'WORKER_OBSERVED' });
    expect(toResponseInput(q, d('12.5')).value).toBe(12.5);
    expect(validateDraft(q, d(''))).toBe('value');
    expect(validateDraft(q, d('abc'))).toBe('number');
    expect(validateDraft(q, d('1e3'))).toBe('number');
    expect(validateDraft(q, d('1.25'))).toBe('decimals');
    expect(validateDraft(q, d('31'))).toBe('max');
    expect(validateDraft(q, d('-1'))).toBe('min');
    expect(validateDraft(q, d('30'))).toBeNull();
  });

  it('requires a source for every answer state and a value for ANSWERED', () => {
    const q = question();
    expect(validateDraft(q, draft({ status: 'UNKNOWN' }))).toBe('source');
    expect(validateDraft(q, draft({ status: 'ANSWERED', source: 'WORKER_OBSERVED' }))).toBe('value');
    expect(validateDraft(q, EMPTY_DRAFT)).toBeNull(); // unanswered is allowed (stays missing)
    const multi = question({ answerType: 'MULTI_CHOICE' });
    expect(validateDraft(multi, draft({ status: 'ANSWERED', source: 'WORKER_OBSERVED' }))).toBe('value');
    const text = question({ answerType: 'TEXT', validation: { maxLength: 3 } });
    expect(validateDraft(text, draft({ status: 'ANSWERED', source: 'WORKER_OBSERVED', text: 'long' }))).toBe(
      'tooLong',
    );
  });

  it('round-trips a saved response and ignores stale fields of other types', () => {
    const q = question();
    const saved = response(q, { status: 'UNKNOWN', value: null, source: 'GUARDIAN_REPORTED' });
    const d = draftFromResponse(q, saved);
    expect(d).toMatchObject({ status: 'UNKNOWN', yesNo: null, source: 'GUARDIAN_REPORTED' });
    expect(isSameDraft(q, d, { ...d, number: '5', text: 'leftover' })).toBe(true);
    expect(isSameDraft(q, d, { ...d, status: 'NOT_ASSESSED' })).toBe(false);
  });
});

describe('section payload', () => {
  it('sends only changed answers, clears removed ones and reports invalid ones', () => {
    const [unchanged, changed, removed, fresh, invalid, untouched] = Array.from({ length: 6 }, () =>
      question(),
    );
    const saved = new Map<string, ScreeningResponse>([
      [unchanged!.id, response(unchanged!, {})],
      [changed!.id, response(changed!, {})],
      [removed!.id, response(removed!, {})],
    ]);
    const drafts: Record<string, AnswerDraft> = {
      [unchanged!.id]: draftFromResponse(unchanged!, saved.get(unchanged!.id)),
      [changed!.id]: draft({ status: 'ANSWERED', yesNo: false, source: 'WORKER_OBSERVED' }),
      [removed!.id]: EMPTY_DRAFT,
      [fresh!.id]: draft({ status: 'UNKNOWN', source: 'GUARDIAN_REPORTED' }),
      [invalid!.id]: draft({ status: 'ANSWERED', yesNo: true }), // no source
    };
    const payload = sectionPayload(
      [unchanged!, changed!, removed!, fresh!, invalid!, untouched!],
      drafts,
      saved,
    );
    expect(payload.responses.map((r) => [r.questionId, r.status, r.value])).toEqual([
      [changed!.id, 'ANSWERED', false],
      [fresh!.id, 'UNKNOWN', undefined],
    ]);
    expect(payload.cleared).toEqual([removed!.id]);
    expect(payload.errors).toEqual({ [invalid!.id]: 'source' });
  });

  it('groups questions into sections in protocol order', () => {
    const a = question({ sectionCode: 'A', sortOrder: 20 });
    const b = question({ sectionCode: 'B', sortOrder: 30 });
    const c = question({ sectionCode: 'A', sortOrder: 10 });
    expect(sectionsOf([a, b, c]).map((s) => s.map((q) => q.id))).toEqual([[c.id, a.id], [b.id]]);
  });
});
