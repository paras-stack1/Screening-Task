import { ageInDaysOn, ageOn, todayInIndia, type CalendarDate } from '@balswasthya/shared-contracts';
import { fromDbDate } from '../children/birthDate';

/**
 * Age at screening (Step 6 decision O). Always computed here from the STORED date of birth and the
 * screening date in India (Asia/Kolkata calendar date) - an age sent by the app is never used.
 * Age bands are in completed days: the day of birth is day 0, and leap days count as calendar days.
 */
export interface ScreeningAge {
  screeningDate: CalendarDate;
  dateOfBirth: CalendarDate;
  dobIsEstimated: boolean;
  /** Null when the date of birth is after the screening date (age cannot be determined). */
  ageInDays: number | null;
  age: { years: number; months: number } | null;
}

export function screeningAge(dateOfBirth: Date, dobIsEstimated: boolean, now: Date): ScreeningAge {
  const birth = fromDbDate(dateOfBirth);
  const today = todayInIndia(now);
  const ageInDays = ageInDaysOn(birth, today);
  return {
    screeningDate: today,
    dateOfBirth: birth,
    dobIsEstimated,
    ageInDays,
    age: ageInDays === null ? null : ageOn(birth, today),
  };
}
