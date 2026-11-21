import {
  ageOn,
  CHILD_MAX_AGE_YEARS,
  compareCalendarDates,
  formatCalendarDate,
  parseCalendarDate,
  subtractYearsMonths,
  todayInIndia,
  type AgeEstimate,
  type CalendarDate,
} from '@balswasthya/shared-contracts';
import { AppError } from '../../utils/AppError';

/**
 * Date-of-birth rules (decision C), enforced on the server whatever the app sent:
 *  - an exact date must be a real calendar date, not in the future (India date), and the child
 *    must be at most CHILD_MAX_AGE_YEARS completed years old (ASSUMPTION - programme to confirm);
 *  - an unknown date is given as an age estimate; the server derives the date by calendar
 *    subtraction from today and marks it estimated. The app shows "about N years" for it.
 * Dates are never silently adjusted: an invalid value is rejected with a 422.
 */
export interface ResolvedBirthDate {
  /** UTC midnight of the calendar date, for the @db.Date column. */
  value: Date;
  isEstimated: boolean;
  calendar: CalendarDate;
}

export function toDbDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

export function fromDbDate(value: Date): CalendarDate {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function resolveBirthDate(
  input: { dateOfBirth?: string | undefined; ageEstimate?: AgeEstimate | undefined },
  now: Date,
): ResolvedBirthDate {
  const today = todayInIndia(now);

  if (input.ageEstimate) {
    const calendar = subtractYearsMonths(today, input.ageEstimate.years, input.ageEstimate.months);
    return { value: toDbDate(calendar), isEstimated: true, calendar };
  }

  const calendar = parseCalendarDate(input.dateOfBirth ?? '');
  if (!calendar) {
    throw AppError.unprocessable('INVALID_DATE_OF_BIRTH', 'Date of birth is not a valid calendar date', {
      field: 'dateOfBirth',
    });
  }
  if (compareCalendarDates(calendar, today) > 0) {
    throw AppError.unprocessable('DATE_OF_BIRTH_IN_FUTURE', 'Date of birth cannot be in the future', {
      field: 'dateOfBirth',
    });
  }
  if (ageOn(calendar, today).years > CHILD_MAX_AGE_YEARS) {
    throw AppError.unprocessable(
      'CHILD_AGE_OUT_OF_RANGE',
      `Only children up to ${CHILD_MAX_AGE_YEARS} years can be registered`,
      { field: 'dateOfBirth' },
    );
  }
  return { value: toDbDate(calendar), isEstimated: false, calendar };
}

export function formatDbDate(value: Date): string {
  return formatCalendarDate(fromDbDate(value));
}
