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
import {
  draftFromResponse,
  isSameDraft,
  toResponseInput,
  validateDraft,
  type AnswerDraft,
  type DraftError,
} from './answerDraft';
import { measuredAtFor, type MeasurementDateError } from './measurementDate';
import { checkMeasurementValue, type MeasurementValueError } from './measurementRules';

/**
 * Local, in-memory edits of a COMPLETED screening before they are sent as ONE amendment (Step
 * 6G-2, docs/step-6/amendment-design.md). Nothing is stored on the device. The API decides what
 * is allowed and captures the old values itself; the app only sends the new values.
 */
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];
export type MeasurementQuality = (typeof MEASUREMENT_QUALITIES)[number];

export interface MeasurementEdit {
  value: string;
  unit: MeasurementUnit | '';
  source: MeasurementSource | '';
  quality: MeasurementQuality | '';
  /** Date from a card or the guardian (not for values measured now). */
  day: string;
  month: string;
  year: string;
  notes: string;
}

export type PendingChange =
  | {
      kind: 'RESPONSE';
      key: string;
      category: FourDCategoryCode;
      question: ScreeningQuestion;
      before: ScreeningResponse | undefined;
      draft: AnswerDraft;
    }
  | { kind: 'MEASUREMENT'; key: string; measurement: ScreeningMeasurement; edit: MeasurementEdit }
  | {
      kind: 'CATEGORY_NOTES';
      key: string;
      category: FourDCategoryCode;
      before: string | null;
      notes: string;
    };

export const changeKey = {
  response: (category: FourDCategoryCode, questionId: string) => `R:${category}:${questionId}`,
  measurement: (measurementId: string) => `M:${measurementId}`,
  notes: (category: FourDCategoryCode) => `N:${category}`,
};

export function measurementEditFrom(m: ScreeningMeasurement): MeasurementEdit {
  return {
    value: m.value,
    unit: m.unit as MeasurementUnit,
    source: m.source as MeasurementSource,
    quality: m.quality as MeasurementQuality,
    day: '',
    month: '',
    year: '',
    notes: m.notes ?? '',
  };
}

export type ChangeError =
  | { kind: 'answer'; error: DraftError | 'cleared' }
  | { kind: 'measurement'; error: MeasurementValueError | MeasurementDateError | 'source' | 'quality' }
  | { kind: 'notes'; error: 'tooLong' };

/** True when the edit does not differ from what is recorded now (nothing to send). */
export function isUnchanged(change: PendingChange): boolean {
  switch (change.kind) {
    case 'RESPONSE':
      return isSameDraft(change.question, change.draft, draftFromResponse(change.question, change.before));
    case 'MEASUREMENT': {
      const m = change.measurement;
      const e = change.edit;
      const dateTyped = e.day !== '' || e.month !== '' || e.year !== '';
      return (
        e.value.trim() === m.value &&
        e.unit === m.unit &&
        e.source === m.source &&
        e.quality === m.quality &&
        e.notes.trim() === (m.notes ?? '') &&
        !dateTyped
      );
    }
    case 'CATEGORY_NOTES':
      return change.notes.trim() === (change.before ?? '');
  }
}

/**
 * The API change for one edit, or why it cannot be sent yet. A measured-now value keeps its
 * original time unless the source changes to a card or the guardian (then a date is required).
 */
export function toChangeInput(
  change: PendingChange,
  dateOfBirth: string,
  now: Date,
): { ok: true; input: AmendmentChangeInput } | { ok: false; error: ChangeError } {
  switch (change.kind) {
    case 'RESPONSE': {
      // An amendment cannot remove an answer: "unknown" or "not assessed" are the explicit ways.
      if (change.draft.status === '') return { ok: false, error: { kind: 'answer', error: 'cleared' } };
      const problem = validateDraft(change.question, change.draft);
      if (problem) return { ok: false, error: { kind: 'answer', error: problem } };
      const { questionId, ...rest } = toResponseInput(change.question, change.draft);
      return { ok: true, input: { kind: 'RESPONSE', category: change.category, questionId, ...rest } };
    }
    case 'MEASUREMENT': {
      const e = change.edit;
      const type = change.measurement.type as ScreeningMeasurementType;
      const valueError = checkMeasurementValue(type, e.unit, e.value);
      if (valueError) return { ok: false, error: { kind: 'measurement', error: valueError } };
      if (!e.source) return { ok: false, error: { kind: 'measurement', error: 'source' } };
      if (!e.quality) return { ok: false, error: { kind: 'measurement', error: 'quality' } };
      const dateTyped = e.day !== '' || e.month !== '' || e.year !== '';
      let measuredAt = change.measurement.measuredAt;
      if (e.source !== 'MEASURED' && (dateTyped || e.source !== change.measurement.source)) {
        const when = measuredAtFor(e.source, e, dateOfBirth, now);
        if (!when.ok) return { ok: false, error: { kind: 'measurement', error: when.error } };
        measuredAt = when.measuredAt;
      }
      return {
        ok: true,
        input: {
          kind: 'MEASUREMENT',
          measurementId: change.measurement.id,
          value: e.value.trim(),
          unit: e.unit as MeasurementUnit,
          source: e.source,
          quality: e.quality,
          measuredAt,
          ...(e.notes.trim() ? { notes: e.notes.trim() } : {}),
        },
      };
    }
    case 'CATEGORY_NOTES': {
      const notes = change.notes.trim();
      if (notes.length > 500) return { ok: false, error: { kind: 'notes', error: 'tooLong' } };
      return {
        ok: true,
        input: { kind: 'CATEGORY_NOTES', category: change.category, notes: notes === '' ? null : notes },
      };
    }
  }
}

export const AMENDMENT_REASON_MIN = 3;
export const AMENDMENT_REASON_MAX = 500;

export function reasonError(reason: string): 'required' | 'tooLong' | null {
  const value = reason.trim();
  if (value.length < AMENDMENT_REASON_MIN) return 'required';
  return value.length > AMENDMENT_REASON_MAX ? 'tooLong' : null;
}
