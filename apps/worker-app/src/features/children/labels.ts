import { ageOn, parseCalendarDate, todayInIndia, type CalendarDate } from '@balswasthya/shared-contracts';
import { isTranslationKey, type TranslateFn } from '../../localization';

/** Translated label for a server enum value; unknown values are shown as-is (never hidden). */
function enumLabel(t: TranslateFn, prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  return isTranslationKey(key) ? t(key) : value;
}

export const relationshipLabel = (t: TranslateFn, value: string) =>
  enumLabel(t, 'children.relationship', value);
export const sexLabel = (t: TranslateFn, value: string) => enumLabel(t, 'children.sex', value);

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" -> "DD/MM/YYYY" (the format used on Indian forms). */
export function formatCalendarDate(value: string): string {
  const date = parseCalendarDate(value);
  return date ? `${pad(date.day)}/${pad(date.month)}/${date.year}` : value;
}

/** An ISO timestamp shown as the calendar date in India. */
export function formatIndiaDate(isoTimestamp: string): string {
  const date: CalendarDate = todayInIndia(new Date(isoTimestamp));
  return `${pad(date.day)}/${pad(date.month)}/${date.year}`;
}

/**
 * An ISO timestamp as date and time in India, "DD/MM/YYYY HH:MM" (24-hour). India has no daylight
 * saving, so a fixed +05:30 offset is exact. Used where the time matters (e.g. the 7-day limit for
 * correcting a screening).
 */
export function formatIndiaDateTime(isoTimestamp: string): string {
  const shifted = new Date(new Date(isoTimestamp).getTime() + (5 * 60 + 30) * 60_000);
  return `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}/${shifted.getUTCFullYear()} ${pad(
    shifted.getUTCHours(),
  )}:${pad(shifted.getUTCMinutes())}`;
}

/** Calendar age, e.g. "3 years 2 months" / "5 months" (never year subtraction). */
export function ageText(t: TranslateFn, dateOfBirth: string, now: Date = new Date()): string {
  const birth = parseCalendarDate(dateOfBirth);
  if (!birth) return '';
  const { years, months } = ageOn(birth, todayInIndia(now));
  return years > 0 ? t('children.age.yearsMonths', { years, months }) : t('children.age.months', { months });
}

/**
 * Birth line for a child. An ESTIMATED date is never shown as if it were exact: only the
 * approximate age is displayed, clearly marked.
 */
export function birthText(
  t: TranslateFn,
  child: { dateOfBirth: string; dobIsEstimated: boolean },
  now?: Date,
) {
  const age = ageText(t, child.dateOfBirth, now);
  return child.dobIsEstimated
    ? t('children.age.estimated', { age })
    : t('children.age.exact', { date: formatCalendarDate(child.dateOfBirth), age });
}

export function areaLabel(language: string, area: { areaName: string; areaNameHi: string | null }) {
  return language === 'hi' && area.areaNameHi ? area.areaNameHi : area.areaName;
}
