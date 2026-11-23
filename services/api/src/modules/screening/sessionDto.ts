import {
  ageOn,
  FOUR_D_CATEGORIES,
  formatCalendarDate,
  todayInIndia,
  type CategoryCompleteness,
  type MeasurementUnit,
  type ScreeningMeasurementType,
  type ScreeningSessionDetail,
  type ScreeningSessionSummary,
} from '@balswasthya/shared-contracts';
import type { Prisma, ScreeningQuestion } from '@prisma/client';
import { fromDbDate } from '../children/birthDate';
import { currentState, toAmendmentDto, type CurrentResponse } from './amendmentOverlay';
import { toDisplayUnit } from './measurementRules';
import { toSummary } from './protocols.service';
import type { SessionTextSealer } from './sensitiveText';

/** Fields for list rows: no answers, notes or measurements. */
export const summaryInclude = {
  child: { select: { fullName: true } },
  conductedBy: { select: { displayName: true } },
  categories: {
    select: {
      category: true,
      status: true,
      protocolStatusAtStart: true,
      protocol: { select: { isDemonstration: true } },
    },
    // D1 -> D4 (PostgreSQL orders enums by declaration): deterministic, display order.
    orderBy: { category: 'asc' },
  },
} satisfies Prisma.ScreeningSessionInclude;
export type SummaryRow = Prisma.ScreeningSessionGetPayload<{ include: typeof summaryInclude }>;

export const detailInclude = {
  child: { select: { fullName: true } },
  conductedBy: { select: { displayName: true } },
  cancelledBy: { select: { displayName: true } },
  categories: {
    include: {
      protocol: { include: { questions: true } },
      observations: { include: { recordedBy: { select: { displayName: true } } } },
    },
    // D1 -> D4 (PostgreSQL orders enums by declaration): deterministic, display order.
    orderBy: { category: 'asc' },
  },
  measurements: {
    include: { recordedBy: { select: { displayName: true } }, supersededBy: { select: { id: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  // Step 6G: amendment versions, oldest first (version 2, 3, ...).
  amendments: {
    include: {
      changes: { orderBy: [{ kind: 'asc' }, { id: 'asc' }] },
      amendedBy: { select: { displayName: true } },
      reviewedBy: { select: { displayName: true } },
      _count: { select: { referralImpacts: true } },
    },
    orderBy: { sequence: 'asc' },
  },
} satisfies Prisma.ScreeningSessionInclude;
export type DetailRow = Prisma.ScreeningSessionGetPayload<{ include: typeof detailInclude }>;

const isApproved = (c: { protocolStatusAtStart: string; protocol: { isDemonstration: boolean } }) =>
  c.protocolStatusAtStart === 'ACTIVE' && !c.protocol.isDemonstration;

export function toSessionSummary(row: SummaryRow | DetailRow, userId: string): ScreeningSessionSummary {
  return {
    id: row.id,
    childId: row.childId,
    childName: row.child.fullName,
    status: row.status,
    version: row.version,
    screeningDate: formatCalendarDate(todayInIndia(row.startedAt)),
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    conductedByName: row.conductedBy.displayName,
    isMine: row.conductedById === userId,
    ageInDaysAtStart: row.ageInDaysAtStart,
    dobEstimatedAtStart: row.dobEstimatedAtStart,
    categories: row.categories.map((c) => ({ category: c.category, status: c.status })),
    usesUnapprovedContent: row.categories.some((c) => !isApproved(c)),
  };
}

/** Counts per state. A question without a record is "not answered" - never a "No". */
export function completeness(
  questions: readonly ScreeningQuestion[],
  answers: ReadonlyArray<{ questionId: string; status: string }>,
): CategoryCompleteness {
  const byQuestion = new Map(answers.map((o) => [o.questionId, o]));
  const required = questions.filter((q) => q.isRequired);
  const count = (pred: (o: { status: string }) => boolean) => answers.filter(pred).length;
  return {
    totalQuestions: questions.length,
    requiredQuestions: required.length,
    requiredAddressed: required.filter((q) => byQuestion.has(q.id)).length,
    answered: count((o) => o.status === 'ANSWERED'),
    unknown: count((o) => o.status === 'UNKNOWN'),
    notAssessed: count((o) => o.status === 'NOT_ASSESSED' || o.status === 'UNABLE_TO_ASSESS'),
    notAnswered: questions.filter((q) => !byQuestion.has(q.id)).length,
  };
}

/** What the caller may do with amendments (decided by the service from scope and time). */
export interface AmendmentAccess {
  canAmend: boolean;
  amendBasis: 'CONDUCTOR_WITHIN_WINDOW' | 'MEDICAL_OFFICER' | null;
  amendableUntil: string | null;
  canReviewAmendments: boolean;
}

const NO_AMENDMENT_ACCESS: AmendmentAccess = {
  canAmend: false,
  amendBasis: null,
  amendableUntil: null,
  canReviewAmendments: false,
};

/**
 * Free text is decrypted here, for the authorised caller only (sealer bound to this session).
 * Answers, measurements and area notes are the CURRENT values: the original with every
 * amendment applied (Step 6G); `amended` marks values that come from an amendment.
 */
export function toSessionDetail(
  row: DetailRow,
  userId: string,
  text: SessionTextSealer,
  access: AmendmentAccess = NO_AMENDMENT_ACCESS,
): ScreeningSessionDetail {
  const dob = fromDbDate(row.dateOfBirthAtStart);
  const started = new Set(row.categories.map((c) => c.category));
  const state = currentState(row, text);
  const categoryById = new Map(row.categories.map((c) => [c.id, c.category]));
  const questionCode = new Map(
    row.categories.flatMap((c) => c.protocol.questions.map((q) => [q.id, q.code] as const)),
  );

  return {
    ...toSessionSummary(row, userId),
    dateOfBirthAtStart: formatCalendarDate(dob),
    ageAtStart: ageOn(dob, todayInIndia(row.startedAt)),
    screeningConsentId: row.screeningConsentId,
    cancelReason: text.open({ kind: 'session', field: 'cancelReason' }, row.cancelReason),
    cancelledByName: row.cancelledBy?.displayName ?? null,
    canEdit: row.conductedById === userId && (row.status === 'DRAFT' || row.status === 'IN_PROGRESS'),
    sessionCategories: row.categories.map((c) => {
      const questions = new Map(c.protocol.questions.map((q) => [q.id, q]));
      const current = [...(state.responses.get(c.id) ?? new Map<string, CurrentResponse>()).entries()];
      const notes = state.categoryNotes.get(c.id)!;
      return {
        id: c.id,
        category: c.category,
        status: c.status,
        protocol: toSummary(c.protocol, c.protocol.questions.length),
        protocolStatusAtStart: c.protocolStatusAtStart,
        usedApprovedContent: isApproved(c),
        notes: notes.notes,
        notesAmended: notes.amended,
        startedAt: c.startedAt.toISOString(),
        completedAt: c.completedAt?.toISOString() ?? null,
        completeness: completeness(
          c.protocol.questions,
          current.map(([questionId, r]) => ({ questionId, status: r.record.status })),
        ),
        responses: current
          .map(([questionId, r]) => {
            const q = questions.get(questionId)!;
            return {
              sort: q.sortOrder,
              response: {
                id: r.id,
                questionId,
                questionCode: q.code,
                status: r.record.status as 'ANSWERED',
                source: r.record.source as 'WORKER_OBSERVED',
                value: r.record.value,
                notAssessedReason: r.record.notAssessedReason,
                notes: r.record.notes,
                recordedAt: r.recordedAt.toISOString(),
                updatedAt: r.updatedAt.toISOString(),
                recordedByName: r.recordedByName,
                amended: r.amended,
              },
            };
          })
          .sort((a, b) => a.sort - b.sort)
          .map((x) => x.response),
      };
    }),
    categoriesNotAssessed: FOUR_D_CATEGORIES.filter((c) => !started.has(c)),
    measurements: row.measurements.map((m) => {
      const current = state.measurements.get(m.id)!;
      const r = current.record;
      return {
        id: m.id,
        type: m.type,
        value: r.value,
        unit: r.unit,
        converted: toDisplayUnit(m.type as ScreeningMeasurementType, r.value, r.unit as MeasurementUnit),
        source: r.source,
        quality: r.quality,
        method: m.method,
        deviceMake: m.deviceMake,
        deviceModel: m.deviceModel,
        deviceSerial: m.deviceSerial,
        notes: r.notes,
        measuredAt: r.measuredAt,
        recordedAt: m.createdAt.toISOString(),
        recordedByName: m.recordedBy.displayName,
        supersedesId: m.supersedesId,
        correctionReason: text.open(
          { kind: 'measurement', measurementId: m.id, field: 'correctionReason' },
          m.correctionReason,
        ),
        isCurrent: m.supersededBy === null,
        amended: current.amended,
      };
    }),
    screeningRulesApplied: false,
    currentVersion: row.amendments.length + 1,
    amendments: row.amendments.map((a) =>
      toAmendmentDto(a, text, {
        categoryOf: (id) => categoryById.get(id) ?? null,
        questionCodeOf: (id) => questionCode.get(id) ?? null,
      }),
    ),
    ...access,
  };
}
