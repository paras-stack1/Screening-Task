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
import type { Prisma, ScreeningObservation, ScreeningQuestion } from '@prisma/client';
import { fromDbDate } from '../children/birthDate';
import { toDisplayUnit } from './measurementRules';
import { toSummary } from './protocols.service';
import { responseValue } from './responseRules';
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
  observations: readonly ScreeningObservation[],
): CategoryCompleteness {
  const byQuestion = new Map(observations.map((o) => [o.questionId, o]));
  const required = questions.filter((q) => q.isRequired);
  const count = (pred: (o: ScreeningObservation) => boolean) => observations.filter(pred).length;
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

/** Free text is decrypted here, for the authorised caller only (sealer bound to this session). */
export function toSessionDetail(
  row: DetailRow,
  userId: string,
  text: SessionTextSealer,
): ScreeningSessionDetail {
  const dob = fromDbDate(row.dateOfBirthAtStart);
  const started = new Set(row.categories.map((c) => c.category));
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
      return {
        id: c.id,
        category: c.category,
        status: c.status,
        protocol: toSummary(c.protocol, c.protocol.questions.length),
        protocolStatusAtStart: c.protocolStatusAtStart,
        usedApprovedContent: isApproved(c),
        notes: text.open({ kind: 'cat', category: c.category, field: 'notes' }, c.notes),
        startedAt: c.startedAt.toISOString(),
        completedAt: c.completedAt?.toISOString() ?? null,
        completeness: completeness(c.protocol.questions, c.observations),
        responses: c.observations
          .map((o) => {
            const q = questions.get(o.questionId)!;
            const field = (f: 'valueText' | 'notes' | 'notAssessedReason') =>
              ({ kind: 'obs', questionId: o.questionId, field: f }) as const;
            const plain = {
              ...o,
              valueText: text.open(field('valueText'), o.valueText),
              notes: text.open(field('notes'), o.notes),
              notAssessedReason: text.open(field('notAssessedReason'), o.notAssessedReason),
            };
            return {
              sort: q.sortOrder,
              response: {
                id: o.id,
                questionId: o.questionId,
                questionCode: q.code,
                status: o.status,
                source: o.source,
                value: responseValue(q, plain),
                notAssessedReason: plain.notAssessedReason,
                notes: plain.notes,
                recordedAt: o.recordedAt.toISOString(),
                updatedAt: o.updatedAt.toISOString(),
                recordedByName: o.recordedBy.displayName,
              },
            };
          })
          .sort((a, b) => a.sort - b.sort)
          .map((x) => x.response),
      };
    }),
    categoriesNotAssessed: FOUR_D_CATEGORIES.filter((c) => !started.has(c)),
    measurements: row.measurements.map((m) => {
      const value = m.value.toFixed(m.value.decimalPlaces());
      return {
        id: m.id,
        type: m.type,
        value,
        unit: m.unit,
        converted: toDisplayUnit(m.type as ScreeningMeasurementType, value, m.unit as MeasurementUnit),
        source: m.source,
        quality: m.quality,
        method: m.method,
        deviceMake: m.deviceMake,
        deviceModel: m.deviceModel,
        deviceSerial: m.deviceSerial,
        notes: text.open({ kind: 'measurement', measurementId: m.id, field: 'notes' }, m.notes),
        measuredAt: m.measuredAt.toISOString(),
        recordedAt: m.createdAt.toISOString(),
        recordedByName: m.recordedBy.displayName,
        supersedesId: m.supersedesId,
        correctionReason: text.open(
          { kind: 'measurement', measurementId: m.id, field: 'correctionReason' },
          m.correctionReason,
        ),
        isCurrent: m.supersededBy === null,
      };
    }),
    screeningRulesApplied: false,
  };
}
