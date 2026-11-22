/**
 * Calendar-date helpers shared by the API and the worker app (Step 5, decision C).
 *
 * Dates of birth are CALENDAR dates ("YYYY-MM-DD"), not instants: they are never converted
 * through a device timezone. "Today" is the calendar date in India (Asia/Kolkata, UTC+05:30,
 * no daylight saving), so a registration at 01:00 IST is not judged against the UTC date.
 * Ages are calculated by calendar (years, months, days), never by subtracting years.
 */
export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** Parses "YYYY-MM-DD"; returns null for malformed or impossible dates (e.g. 2023-02-29). */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatCalendarDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The calendar date in India at the given instant. */
export function todayInIndia(now: Date): CalendarDate {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Subtracts whole years and months. If the day does not exist in the target month it is clamped
 * to the month's last day (31 March minus 1 month = 28/29 February; 29 Feb 2024 minus 1 year =
 * 28 Feb 2023).
 */
export function subtractYearsMonths(date: CalendarDate, years: number, months: number): CalendarDate {
  const totalMonths = date.year * 12 + (date.month - 1) - years * 12 - months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/**
 * Completed years and months between `birth` and `on` (0 if `on` is before `birth`). A month is
 * completed when the birth day-of-month is reached, clamped to the month's last day: a child
 * born on 31 January completes one month on 28/29 February, and a child born on 29 February
 * completes a year on 28 February in non-leap years.
 */
export function ageOn(birth: CalendarDate, on: CalendarDate): { years: number; months: number } {
  let months = (on.year - birth.year) * 12 + (on.month - birth.month);
  const birthDayInTargetMonth = Math.min(birth.day, daysInMonth(on.year, on.month));
  if (on.day < birthDayInTargetMonth) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole calendar days from `from` to `to` (negative if `to` is earlier). Exact: both dates are
 * taken as UTC midnights, where every day is 86 400 000 ms (no daylight saving, no device
 * timezone), and leap days are counted by the calendar itself.
 */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Age in completed days on a date (Step 6 decision O): the day of birth is day 0. Returns null
 * when `on` is before the birth date - an age is never invented for an impossible date.
 */
export function ageInDaysOn(birth: CalendarDate, on: CalendarDate): number | null {
  const days = daysBetween(birth, on);
  return days < 0 ? null : days;
}

/** Age limits for registration. ASSUMPTION (RBSK covers 0-18 years) - requires programme confirmation. */
export const CHILD_MAX_AGE_YEARS = 18;
