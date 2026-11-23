import type {
  ScreeningMeasurement,
  ScreeningQuestion,
  ScreeningResponse,
} from '@balswasthya/shared-contracts';
import { formatIndiaDateTime } from '../../src/features/children/labels';
import {
  isUnchanged,
  measurementEditFrom,
  reasonError,
  toChangeInput,
  type PendingChange,
} from '../../src/features/screening/amendDraft';
import { draftFromResponse, EMPTY_DRAFT } from '../../src/features/screening/answerDraft';

/** Step 6G-2: turning on-screen corrections into one amendment request. Synthetic data only. */
const QID = '00000000-0000-4000-b000-000001000001';
const MID = '00000000-0000-4000-8c00-000000000009';
const question: ScreeningQuestion = {
  id: QID,
  code: 'Q1',
  sectionCode: 'S_A',
  sortOrder: 10,
  prompt: { hi: 'प्रश्न', en: 'Question' },
  help: null,
  answerType: 'YES_NO',
  options: null,
  validation: null,
  isRequired: true,
};
const saved: ScreeningResponse = {
  id: 'r1',
  questionId: QID,
  questionCode: 'Q1',
  status: 'ANSWERED',
  source: 'WORKER_OBSERVED',
  value: true,
  notAssessedReason: null,
  notes: null,
  recordedAt: '2026-11-21T09:00:00.000Z',
  updatedAt: '2026-11-21T09:00:00.000Z',
  recordedByName: 'Synthetic Worker',
  amended: false,
};
const weight: ScreeningMeasurement = {
  id: MID,
  type: 'WEIGHT',
  value: '12.5',
  unit: 'kg',
  converted: { value: '12.5', unit: 'kg' },
  source: 'MEASURED',
  quality: 'RELIABLE',
  method: null,
  deviceMake: null,
  deviceModel: null,
  deviceSerial: null,
  notes: null,
  measuredAt: '2026-11-21T09:00:00.000Z',
  recordedAt: '2026-11-21T09:00:00.000Z',
  recordedByName: 'Synthetic Worker',
  supersedesId: null,
  correctionReason: null,
  isCurrent: true,
  amended: false,
};
const DOB = '2023-05-10';
const NOW = new Date('2026-11-23T06:00:00.000Z');

const response = (draft = draftFromResponse(question, saved)): PendingChange => ({
  kind: 'RESPONSE',
  key: 'k',
  category: 'DEFECTS_AT_BIRTH',
  question,
  before: saved,
  draft,
});
const measurement = (patch = {}): PendingChange => ({
  kind: 'MEASUREMENT',
  key: 'm',
  measurement: weight,
  edit: { ...measurementEditFrom(weight), ...patch },
});

describe('answers', () => {
  it('an untouched answer is "unchanged"; a different value becomes a RESPONSE change', () => {
    expect(isUnchanged(response())).toBe(true);
    const change = response({ ...draftFromResponse(question, saved), yesNo: false });
    expect(isUnchanged(change)).toBe(false);
    expect(toChangeInput(change, DOB, NOW)).toEqual({
      ok: true,
      input: {
        kind: 'RESPONSE',
        category: 'DEFECTS_AT_BIRTH',
        questionId: QID,
        status: 'ANSWERED',
        source: 'WORKER_OBSERVED',
        value: false,
      },
    });
  });

  it('an answer cannot be removed by an amendment (use Unknown / Not assessed)', () => {
    expect(toChangeInput(response(EMPTY_DRAFT), DOB, NOW)).toEqual({
      ok: false,
      error: { kind: 'answer', error: 'cleared' },
    });
  });

  it('the normal answer rules still apply (a source is required)', () => {
    const change = response({ ...EMPTY_DRAFT, status: 'UNKNOWN' });
    expect(toChangeInput(change, DOB, NOW)).toEqual({
      ok: false,
      error: { kind: 'answer', error: 'source' },
    });
  });
});

describe('measurements', () => {
  it('a new value keeps the original measuring time when the source stays "measured now"', () => {
    expect(isUnchanged(measurement())).toBe(true);
    const result = toChangeInput(measurement({ value: '12.8' }), DOB, NOW);
    expect(result).toEqual({
      ok: true,
      input: {
        kind: 'MEASUREMENT',
        measurementId: MID,
        value: '12.8',
        unit: 'kg',
        source: 'MEASURED',
        quality: 'RELIABLE',
        measuredAt: weight.measuredAt,
      },
    });
  });

  it('changing to "from a card" requires the card date, stored as the start of that day in India', () => {
    expect(toChangeInput(measurement({ source: 'FROM_RECORD' }), DOB, NOW)).toEqual({
      ok: false,
      error: { kind: 'measurement', error: 'date' },
    });
    const result = toChangeInput(
      measurement({ source: 'FROM_RECORD', day: '15', month: '11', year: '2026' }),
      DOB,
      NOW,
    );
    expect(result).toMatchObject({ ok: true, input: { measuredAt: '2026-11-14T18:30:00.000Z' } });
  });

  it('precision, future dates and dates before birth are refused before sending', () => {
    expect(toChangeInput(measurement({ value: '12.555' }), DOB, NOW)).toMatchObject({
      ok: false,
      error: { error: 'decimals' },
    });
    expect(
      toChangeInput(measurement({ source: 'FROM_RECORD', day: '1', month: '1', year: '2027' }), DOB, NOW),
    ).toMatchObject({ ok: false, error: { error: 'dateFuture' } });
    expect(
      toChangeInput(
        measurement({ source: 'GUARDIAN_REPORTED', day: '1', month: '1', year: '2020' }),
        DOB,
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { error: 'dateBeforeBirth' } });
  });
});

describe('observations and reason', () => {
  it('emptied observations are sent as null (removed), with a change kept in the history by the API', () => {
    const change: PendingChange = {
      kind: 'CATEGORY_NOTES',
      key: 'n',
      category: 'DISEASES',
      before: 'old note',
      notes: '   ',
    };
    expect(isUnchanged(change)).toBe(false);
    expect(toChangeInput(change, DOB, NOW)).toEqual({
      ok: true,
      input: { kind: 'CATEGORY_NOTES', category: 'DISEASES', notes: null },
    });
  });

  it('a reason of 3 to 500 characters is required', () => {
    expect(reasonError('  ')).toBe('required');
    expect(reasonError('ab')).toBe('required');
    expect(reasonError('Ticked by mistake')).toBeNull();
    expect(reasonError('x'.repeat(501))).toBe('tooLong');
  });
});

describe('India date and time', () => {
  it('shows the exact end of the 7-day window in India time, across midnight', () => {
    expect(formatIndiaDateTime('2026-11-30T20:15:00.000Z')).toBe('01/12/2026 01:45');
    expect(formatIndiaDateTime('2026-11-21T09:00:00.000Z')).toBe('21/11/2026 14:30');
  });
});
