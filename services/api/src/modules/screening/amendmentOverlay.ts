import type {
  AmendmentChange,
  ResponseValue,
  ScreeningAmendment as ScreeningAmendmentDto,
} from '@balswasthya/shared-contracts';
import type { Prisma, ScreeningObservation, ScreeningQuestion } from '@prisma/client';
import { responseValue } from './responseRules';
import type { SessionTextSealer } from './sensitiveText';

/**
 * The CURRENT version of a completed screening (Step 6G): the original rows - never changed -
 * with every amendment applied in sequence order. The same function serves the read side (summary)
 * and the amendment service (to capture exact "old values"), so both always agree.
 *
 * Stored old/new values are JSON; their free-text parts are encrypted and bound to the change id
 * and side (old/new) - see sensitiveText.ts.
 */

export interface ResponseRecord {
  status: string;
  source: string;
  value: ResponseValue | null;
  notAssessedReason: string | null;
  notes: string | null;
}
export interface MeasurementRecord {
  value: string;
  unit: string;
  source: string;
  quality: string;
  measuredAt: string;
  notes: string | null;
}
export interface NotesRecord {
  notes: string | null;
}

type Side = 'old' | 'new';
type Json = Prisma.JsonObject;

// ------------------------------------------------------------- sealing old/new values

export function sealResponse(
  text: SessionTextSealer,
  changeId: string,
  side: Side,
  r: ResponseRecord,
  q: ScreeningQuestion,
): Json {
  const f = (field: 'value' | 'notes' | 'notAssessedReason') =>
    ({ kind: 'amendmentChange', changeId, side, field }) as const;
  const isText = q.answerType === 'TEXT' && typeof r.value === 'string';
  return {
    status: r.status,
    source: r.source,
    // Text answers are free text (encrypted); codes, numbers and booleans stay structured.
    value: isText ? null : r.value,
    valueText: isText ? text.seal(f('value'), r.value as string) : null,
    notAssessedReason: text.seal(f('notAssessedReason'), r.notAssessedReason),
    notes: text.seal(f('notes'), r.notes),
  };
}

export function openResponse(
  text: SessionTextSealer,
  changeId: string,
  side: Side,
  json: unknown,
): ResponseRecord {
  const j = json as Record<string, unknown>;
  const f = (field: 'value' | 'notes' | 'notAssessedReason') =>
    ({ kind: 'amendmentChange', changeId, side, field }) as const;
  const valueText = text.open(f('value'), (j.valueText as string | null) ?? null);
  return {
    status: j.status as string,
    source: j.source as string,
    value: valueText ?? (j.value as ResponseValue | null) ?? null,
    notAssessedReason: text.open(f('notAssessedReason'), (j.notAssessedReason as string | null) ?? null),
    notes: text.open(f('notes'), (j.notes as string | null) ?? null),
  };
}

export function sealMeasurement(
  text: SessionTextSealer,
  changeId: string,
  side: Side,
  m: MeasurementRecord,
): Json {
  return {
    value: m.value,
    unit: m.unit,
    source: m.source,
    quality: m.quality,
    measuredAt: m.measuredAt,
    notes: text.seal({ kind: 'amendmentChange', changeId, side, field: 'notes' }, m.notes),
  };
}

export function openMeasurement(
  text: SessionTextSealer,
  changeId: string,
  side: Side,
  json: unknown,
): MeasurementRecord {
  const j = json as Record<string, unknown>;
  return {
    value: j.value as string,
    unit: j.unit as string,
    source: j.source as string,
    quality: j.quality as string,
    measuredAt: j.measuredAt as string,
    notes: text.open(
      { kind: 'amendmentChange', changeId, side, field: 'notes' },
      (j.notes as string | null) ?? null,
    ),
  };
}

export function sealNotes(text: SessionTextSealer, changeId: string, side: Side, n: NotesRecord): Json {
  return { notes: text.seal({ kind: 'amendmentChange', changeId, side, field: 'notes' }, n.notes) };
}

export function openNotes(text: SessionTextSealer, changeId: string, side: Side, json: unknown): NotesRecord {
  const j = json as Record<string, unknown>;
  return {
    notes: text.open(
      { kind: 'amendmentChange', changeId, side, field: 'notes' },
      (j.notes as string | null) ?? null,
    ),
  };
}

// --------------------------------------------------------------------- the overlay

/** What the overlay needs from a session (a subset of the detail row). */
export interface OverlaySource {
  id: string;
  categories: Array<{
    id: string;
    category: string;
    notes: string | null;
    protocol: { questions: ScreeningQuestion[] };
    observations: Array<ScreeningObservation & { recordedBy: { displayName: string } }>;
  }>;
  measurements: Array<{
    id: string;
    value: Prisma.Decimal;
    unit: string;
    source: string;
    quality: string;
    measuredAt: Date;
    notes: string | null;
  }>;
  amendments: Array<{
    id: string;
    sequence: number;
    amendedAt: Date;
    amendedBy: { displayName: string };
    changes: Array<{
      id: string;
      kind: string;
      sessionCategoryId: string | null;
      questionId: string | null;
      measurementId: string | null;
      oldValue: unknown;
      newValue: unknown;
      clinicallySignificant: boolean;
    }>;
  }>;
}

export interface CurrentResponse {
  id: string;
  record: ResponseRecord;
  amended: boolean;
  recordedAt: Date;
  recordedByName: string;
  updatedAt: Date;
}

export interface CurrentState {
  /** sessionCategoryId -> questionId -> current answer (no entry = not answered). */
  responses: Map<string, Map<string, CurrentResponse>>;
  measurements: Map<string, { record: MeasurementRecord; amended: boolean }>;
  categoryNotes: Map<string, { notes: string | null; amended: boolean }>;
}

export function currentState(source: OverlaySource, text: SessionTextSealer): CurrentState {
  const responses = new Map<string, Map<string, CurrentResponse>>();
  const categoryNotes = new Map<string, { notes: string | null; amended: boolean }>();
  for (const c of source.categories) {
    const questions = new Map(c.protocol.questions.map((q) => [q.id, q]));
    const byQuestion = new Map<string, CurrentResponse>();
    for (const o of c.observations) {
      const field = (f: 'valueText' | 'notes' | 'notAssessedReason') =>
        ({ kind: 'obs', questionId: o.questionId, field: f }) as const;
      const plain = {
        ...o,
        valueText: text.open(field('valueText'), o.valueText),
        notes: text.open(field('notes'), o.notes),
        notAssessedReason: text.open(field('notAssessedReason'), o.notAssessedReason),
      };
      byQuestion.set(o.questionId, {
        id: o.id,
        record: {
          status: o.status,
          source: o.source,
          value: responseValue(questions.get(o.questionId)!, plain),
          notAssessedReason: plain.notAssessedReason,
          notes: plain.notes,
        },
        amended: false,
        recordedAt: o.recordedAt,
        recordedByName: o.recordedBy.displayName,
        updatedAt: o.updatedAt,
      });
    }
    responses.set(c.id, byQuestion);
    categoryNotes.set(c.id, {
      notes: text.open({ kind: 'cat', category: c.category, field: 'notes' }, c.notes),
      amended: false,
    });
  }
  const measurements = new Map<string, { record: MeasurementRecord; amended: boolean }>();
  for (const m of source.measurements) {
    measurements.set(m.id, {
      record: {
        value: m.value.toFixed(m.value.decimalPlaces()),
        unit: m.unit,
        source: m.source,
        quality: m.quality,
        measuredAt: m.measuredAt.toISOString(),
        notes: text.open({ kind: 'measurement', measurementId: m.id, field: 'notes' }, m.notes),
      },
      amended: false,
    });
  }

  for (const a of [...source.amendments].sort((x, y) => x.sequence - y.sequence)) {
    for (const change of a.changes) {
      if (change.kind === 'RESPONSE') {
        responses.get(change.sessionCategoryId!)!.set(change.questionId!, {
          id: change.id,
          record: openResponse(text, change.id, 'new', change.newValue),
          amended: true,
          recordedAt: a.amendedAt,
          recordedByName: a.amendedBy.displayName,
          updatedAt: a.amendedAt,
        });
      } else if (change.kind === 'MEASUREMENT') {
        measurements.set(change.measurementId!, {
          record: openMeasurement(text, change.id, 'new', change.newValue),
          amended: true,
        });
      } else {
        categoryNotes.set(change.sessionCategoryId!, {
          notes: openNotes(text, change.id, 'new', change.newValue).notes,
          amended: true,
        });
      }
    }
  }
  return { responses, measurements, categoryNotes };
}

// ---------------------------------------------------------------- history (DTO)

export interface AmendmentRow {
  id: string;
  sequence: number;
  amendedAt: Date;
  amendedById: string;
  amendedBy: { displayName: string };
  basis: 'CONDUCTOR_WITHIN_WINDOW' | 'MEDICAL_OFFICER';
  reason: string;
  clinicallySignificant: boolean;
  reviewStatus: 'NOT_REQUIRED' | 'PENDING' | 'REVIEWED';
  reviewedById: string | null;
  reviewedBy: { displayName: string } | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  _count: { referralImpacts: number };
  changes: OverlaySource['amendments'][number]['changes'];
}

export function toAmendmentDto(
  a: AmendmentRow,
  text: SessionTextSealer,
  lookup: {
    categoryOf: (sessionCategoryId: string) => string | null;
    questionCodeOf: (questionId: string) => string | null;
  },
): ScreeningAmendmentDto {
  const values = (change: AmendmentRow['changes'][number], side: Side) => {
    const json = side === 'old' ? change.oldValue : change.newValue;
    if (json === null || json === undefined) return null;
    const record =
      change.kind === 'RESPONSE'
        ? openResponse(text, change.id, side, json)
        : change.kind === 'MEASUREMENT'
          ? openMeasurement(text, change.id, side, json)
          : openNotes(text, change.id, side, json);
    return { ...record };
  };
  return {
    id: a.id,
    sequence: a.sequence,
    version: a.sequence + 1,
    amendedAt: a.amendedAt.toISOString(),
    amendedByName: a.amendedBy.displayName,
    basis: a.basis,
    reason: text.open({ kind: 'amendment', amendmentId: a.id, field: 'reason' }, a.reason)!,
    clinicallySignificant: a.clinicallySignificant,
    reviewStatus: a.reviewStatus,
    reviewedByName: a.reviewedBy?.displayName ?? null,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    reviewNotes: text.open({ kind: 'amendment', amendmentId: a.id, field: 'reviewNotes' }, a.reviewNotes),
    selfReviewed: a.reviewedById !== null && a.reviewedById === a.amendedById,
    referralsFlagged: a._count.referralImpacts,
    changes: a.changes.map((c): AmendmentChange => ({
      kind: c.kind as AmendmentChange['kind'],
      category: (c.sessionCategoryId
        ? lookup.categoryOf(c.sessionCategoryId)
        : null) as AmendmentChange['category'],
      questionId: c.questionId,
      questionCode: c.questionId ? lookup.questionCodeOf(c.questionId) : null,
      measurementId: c.measurementId,
      oldValue: values(c, 'old'),
      newValue: values(c, 'new'),
      clinicallySignificant: c.clinicallySignificant,
    })),
  };
}
