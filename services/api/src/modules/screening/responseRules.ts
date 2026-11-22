import {
  choiceOptionSchema,
  questionValidationSchema,
  type ResponseInput,
  type ResponseValue,
} from '@balswasthya/shared-contracts';
import type { Prisma, ScreeningObservation, ScreeningQuestion } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../utils/AppError';

/**
 * Checks one answer against its question (Step 6 decision G) and maps it to the typed columns.
 * Missing data stays missing: only ANSWERED carries a value, and UNKNOWN / NOT_ASSESSED /
 * UNABLE_TO_ASSESS are stored as states, never converted to "No". Nothing is adjusted silently:
 * any mismatch is a 422 naming the question code (not the value).
 */
const DEFAULT_TEXT_MAX = 1000;
/** ScreeningObservation.valueNumber is Decimal(10, 3). */
const NUMBER_COLUMN_DECIMALS = 3;
const NUMBER_COLUMN_MAX = 9_999_999;

type ValueColumns = Pick<
  Prisma.ScreeningObservationUncheckedCreateInput,
  'valueBoolean' | 'valueCode' | 'valueCodes' | 'valueNumber' | 'valueText'
>;

const EMPTY: Required<ValueColumns> = {
  valueBoolean: null,
  valueCode: null,
  valueCodes: [],
  valueNumber: null,
  valueText: null,
};

function reject(question: ScreeningQuestion, reason: string): AppError {
  return AppError.unprocessable('INVALID_RESPONSE', `Answer for question ${question.code}: ${reason}`, {
    questionCode: question.code,
  });
}

function plainDecimals(n: number): number | null {
  const s = String(n);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null; // exponent notation (1e-7, 1e21)
  return s.includes('.') ? s.split('.')[1]!.length : 0;
}

export function responseColumns(question: ScreeningQuestion, input: ResponseInput): Required<ValueColumns> {
  if (input.status !== 'ANSWERED') return EMPTY;
  const value = input.value;
  const rules = question.validation === null ? {} : questionValidationSchema.parse(question.validation);
  const options =
    question.options === null
      ? []
      : z
          .array(choiceOptionSchema)
          .parse(question.options)
          .map((o) => o.code);

  switch (question.answerType) {
    case 'YES_NO':
      if (typeof value !== 'boolean') throw reject(question, 'expected yes or no');
      return { ...EMPTY, valueBoolean: value };
    case 'NUMBER': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw reject(question, 'expected a number');
      const decimals = plainDecimals(value);
      const allowed = Math.min(rules.maxDecimals ?? NUMBER_COLUMN_DECIMALS, NUMBER_COLUMN_DECIMALS);
      if (decimals === null || decimals > allowed)
        throw reject(question, `at most ${allowed} decimal places`);
      if (Math.abs(value) > NUMBER_COLUMN_MAX) throw reject(question, 'number too large');
      if (rules.min !== undefined && value < rules.min)
        throw reject(question, `must be at least ${rules.min}`);
      if (rules.max !== undefined && value > rules.max)
        throw reject(question, `must be at most ${rules.max}`);
      return { ...EMPTY, valueNumber: value };
    }
    case 'TEXT': {
      if (typeof value !== 'string' || value.trim() === '') throw reject(question, 'expected text');
      if (value.trim().length > (rules.maxLength ?? DEFAULT_TEXT_MAX))
        throw reject(question, 'text too long');
      return { ...EMPTY, valueText: value.trim() };
    }
    case 'SINGLE_CHOICE':
      if (typeof value !== 'string' || !options.includes(value))
        throw reject(question, 'not one of the options');
      return { ...EMPTY, valueCode: value };
    case 'MULTI_CHOICE': {
      if (!Array.isArray(value) || value.length === 0) throw reject(question, 'choose at least one option');
      if (new Set(value).size !== value.length) throw reject(question, 'an option was chosen twice');
      if (!value.every((v) => options.includes(v))) throw reject(question, 'not one of the options');
      return { ...EMPTY, valueCodes: value };
    }
  }
}

/** Reads the stored typed value back as the API value (null when not ANSWERED). */
export function responseValue(question: ScreeningQuestion, row: ScreeningObservation): ResponseValue | null {
  if (row.status !== 'ANSWERED') return null;
  switch (question.answerType) {
    case 'YES_NO':
      return row.valueBoolean;
    case 'NUMBER':
      return row.valueNumber === null ? null : row.valueNumber.toNumber();
    case 'TEXT':
      return row.valueText;
    case 'SINGLE_CHOICE':
      return row.valueCode;
    case 'MULTI_CHOICE':
      return row.valueCodes.length > 0 ? row.valueCodes : null;
  }
}

/** True when the stored answer differs from the incoming one (for the audit "changed" count). */
export function responseChanged(
  existing: ScreeningObservation,
  next: {
    status: string;
    source: string;
    notes: string | null;
    notAssessedReason: string | null;
  } & Required<ValueColumns>,
): boolean {
  return (
    existing.status !== next.status ||
    existing.source !== next.source ||
    existing.notes !== next.notes ||
    existing.notAssessedReason !== next.notAssessedReason ||
    existing.valueBoolean !== next.valueBoolean ||
    existing.valueCode !== next.valueCode ||
    existing.valueText !== next.valueText ||
    (existing.valueNumber?.toNumber() ?? null) !== (next.valueNumber as number | null) ||
    existing.valueCodes.join('\u0000') !== (next.valueCodes as string[]).join('\u0000')
  );
}
