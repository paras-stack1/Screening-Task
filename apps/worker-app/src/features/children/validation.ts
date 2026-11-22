import {
  ageOn,
  CHILD_MAX_AGE_YEARS,
  compareCalendarDates,
  normalizeIndianMobile,
  parseCalendarDate,
  personNameSchema,
  todayInIndia,
  type GuardianRelationship,
  type RegisterChildRequest,
  type SexAtBirth,
} from '@balswasthya/shared-contracts';
import { z } from 'zod';
import type { TranslationKey } from '../../localization';

/**
 * Client-side checks for quick, translated feedback (messages are translation keys). The API
 * validates everything again and is the authority (docs/api/children.md).
 */
type Ctx = z.RefinementCtx;
const issue = (ctx: Ctx, path: string, message: TranslationKey) =>
  ctx.addIssue({ code: 'custom', path: [path], message });

// ------------------------------------------------------------------------ child fields

export interface ChildFieldValues {
  fullName: string;
  /** No default on purpose: the worker states whether the exact date is known. */
  dobMode: 'exact' | 'estimate' | '';
  day: string;
  month: string;
  year: string;
  ageYears: string;
  ageMonths: string;
  /** '' = not recorded (decision D: optional). */
  sexAtBirth: SexAtBirth | '';
}

export const emptyChildFields: ChildFieldValues = {
  fullName: '',
  dobMode: '',
  day: '',
  month: '',
  year: '',
  ageYears: '',
  ageMonths: '',
  sexAtBirth: '',
};

const DIGITS = /^\d+$/;

/** "YYYY-MM-DD" from the three boxes, or null if they do not form a real date. */
export function datePartsToIso(day: string, month: string, year: string): string | null {
  if (![day, month, year].every((part) => DIGITS.test(part.trim())) || year.trim().length !== 4) return null;
  const iso = `${year.trim()}-${month.trim().padStart(2, '0')}-${day.trim().padStart(2, '0')}`;
  return parseCalendarDate(iso) ? iso : null;
}

export function validateChildFields(values: ChildFieldValues, now: Date, ctx: Ctx) {
  validateChildName(values, ctx);
  validateBirthFields(values, now, ctx);
}

export function validateChildName(values: Pick<ChildFieldValues, 'fullName'>, ctx: Ctx) {
  if (!personNameSchema.safeParse(values.fullName).success) {
    issue(
      ctx,
      'fullName',
      values.fullName.trim() ? 'children.form.errors.nameInvalid' : 'children.form.errors.nameRequired',
    );
  }
}

export function validateBirthFields(values: ChildFieldValues, now: Date, ctx: Ctx) {
  if (values.dobMode === '') {
    issue(ctx, 'dobMode', 'children.form.errors.dobModeRequired');
  } else if (values.dobMode === 'exact') {
    if (!values.day.trim() || !values.month.trim() || !values.year.trim()) {
      issue(ctx, 'day', 'children.form.errors.dobRequired');
      return;
    }
    const iso = datePartsToIso(values.day, values.month, values.year);
    if (!iso) {
      issue(ctx, 'day', 'children.form.errors.dobInvalid');
      return;
    }
    const date = parseCalendarDate(iso)!;
    const today = todayInIndia(now);
    if (compareCalendarDates(date, today) > 0) issue(ctx, 'day', 'children.form.errors.dobFuture');
    else if (ageOn(date, today).years > CHILD_MAX_AGE_YEARS) issue(ctx, 'day', 'children.form.errors.tooOld');
  } else {
    const years = Number(values.ageYears.trim() || 'x');
    const months = Number(values.ageMonths.trim() || '0');
    if (!DIGITS.test(values.ageYears.trim()) || years > CHILD_MAX_AGE_YEARS) {
      issue(ctx, 'ageYears', 'children.form.errors.ageYears');
    }
    if (values.ageMonths.trim() && (!DIGITS.test(values.ageMonths.trim()) || months > 11)) {
      issue(ctx, 'ageMonths', 'children.form.errors.ageMonths');
    }
  }
}

/** Birth fields of a request, from valid form values. */
export function birthPayload(
  values: ChildFieldValues,
): Pick<RegisterChildRequest, 'dateOfBirth' | 'ageEstimate'> {
  if (values.dobMode === 'exact') {
    return { dateOfBirth: datePartsToIso(values.day, values.month, values.year)! };
  }
  return {
    ageEstimate: { years: Number(values.ageYears.trim()), months: Number(values.ageMonths.trim() || '0') },
  };
}

/** Form values for an existing child (edit screen). */
export function childToFields(child: {
  fullName: string;
  dateOfBirth: string;
  dobIsEstimated: boolean;
  sexAtBirth: string;
}): ChildFieldValues {
  const date = parseCalendarDate(child.dateOfBirth);
  return {
    fullName: child.fullName,
    // An estimated date is edited as "approximate age" again, never shown as an exact date.
    dobMode: child.dobIsEstimated ? 'estimate' : 'exact',
    day: date && !child.dobIsEstimated ? String(date.day) : '',
    month: date && !child.dobIsEstimated ? String(date.month) : '',
    year: date && !child.dobIsEstimated ? String(date.year) : '',
    ageYears: '',
    ageMonths: '',
    sexAtBirth: child.sexAtBirth === 'NOT_RECORDED' ? '' : (child.sexAtBirth as SexAtBirth),
  };
}

// ------------------------------------------------------------------------ guardian fields

export interface GuardianFieldValues {
  guardianName: string;
  guardianPhone: string;
  guardianLanguage: 'hi' | 'en';
}

export function validateGuardianFields(values: GuardianFieldValues, ctx: Ctx) {
  if (!personNameSchema.safeParse(values.guardianName).success) {
    issue(
      ctx,
      'guardianName',
      values.guardianName.trim()
        ? 'children.form.errors.nameInvalid'
        : 'children.form.errors.guardianNameRequired',
    );
  }
  if (values.guardianPhone.trim() && !normalizeIndianMobile(values.guardianPhone)) {
    issue(ctx, 'guardianPhone', 'children.form.errors.phoneInvalid');
  }
}

export interface LinkFieldValues {
  relationship: GuardianRelationship | '';
  /** No default (decision L): the worker must answer yes or no. */
  canGiveConsent: 'yes' | 'no' | '';
  isPrimaryContact: boolean;
}

export function validateLinkFields(values: LinkFieldValues, ctx: Ctx) {
  if (!values.relationship) issue(ctx, 'relationship', 'children.form.errors.relationshipRequired');
  if (!values.canGiveConsent) issue(ctx, 'canGiveConsent', 'children.form.errors.consentAuthorityRequired');
}

// ------------------------------------------------------------------------ registration form

export interface RegistrationFormValues extends ChildFieldValues, GuardianFieldValues, LinkFieldValues {
  areaId: string;
  /** 'new' guardian, or reuse a guardian of a sibling (registration from a sibling's profile). */
  guardianSource: 'new' | 'existing';
  existingGuardianId: string;
}

export const emptyRegistration: RegistrationFormValues = {
  ...emptyChildFields,
  areaId: '',
  guardianSource: 'new',
  existingGuardianId: '',
  guardianName: '',
  guardianPhone: '',
  guardianLanguage: 'hi',
  relationship: '',
  canGiveConsent: '',
  isPrimaryContact: true,
};

export function createRegistrationSchema(now: () => Date) {
  return z.custom<RegistrationFormValues>().superRefine((values, ctx) => {
    validateChildFields(values, now(), ctx);
    if (!values.areaId) issue(ctx, 'areaId', 'children.form.errors.areaRequired');
    if (values.guardianSource === 'existing') {
      if (!values.existingGuardianId)
        issue(ctx, 'existingGuardianId', 'children.form.errors.guardianChoiceRequired');
    } else {
      validateGuardianFields(values, ctx);
    }
    validateLinkFields(values, ctx);
  });
}

/** Options the worker confirmed after a duplicate warning. */
export interface DuplicateConfirmations {
  confirmNotDuplicate: boolean;
  confirmNewGuardian: boolean;
}

/** Builds the API request from valid form values. Creator, time and status are never sent. */
export function toRegisterRequest(
  values: RegistrationFormValues,
  clientOperationId: string,
  confirm: DuplicateConfirmations,
): RegisterChildRequest {
  const link = {
    relationship: values.relationship as GuardianRelationship,
    isPrimaryContact: values.isPrimaryContact,
    canGiveConsent: values.canGiveConsent === 'yes',
  };
  const guardian =
    values.guardianSource === 'existing'
      ? { existingGuardianId: values.existingGuardianId, ...link }
      : {
          newGuardian: {
            fullName: values.guardianName,
            ...(values.guardianPhone.trim() && { phone: values.guardianPhone.trim() }),
            preferredLanguage: values.guardianLanguage,
          },
          ...link,
          confirmNewGuardian: confirm.confirmNewGuardian,
        };
  return {
    clientOperationId,
    fullName: values.fullName,
    ...birthPayload(values),
    ...(values.sexAtBirth && { sexAtBirth: values.sexAtBirth }),
    areaId: values.areaId,
    guardians: [guardian],
    confirmNotDuplicate: confirm.confirmNotDuplicate,
  };
}
