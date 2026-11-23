import { compareCalendarDates, parseCalendarDate, todayInIndia } from '@balswasthya/shared-contracts';
import { datePartsToIso } from '../children/validation';

/**
 * When a measurement was taken (Step 6F).
 *
 * - MEASURED (taken now, during this visit): the time of entry.
 * - GUARDIAN_REPORTED / FROM_RECORD: the worker enters the DATE from the card or the guardian.
 *   The time of day is not known, so the value is stored as the START of that day in India
 *   (00:00 Asia/Kolkata) - no time is invented. It must be a real date, not in the future and
 *   not before the date of birth. The API checks future / before-birth again.
 */
export type MeasurementDateError = 'date' | 'dateFuture' | 'dateBeforeBirth';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function measuredAtFor(
  source: 'MEASURED' | 'GUARDIAN_REPORTED' | 'FROM_RECORD',
  parts: { day: string; month: string; year: string },
  dateOfBirth: string,
  now: Date,
): { ok: true; measuredAt: string } | { ok: false; error: MeasurementDateError } {
  if (source === 'MEASURED') return { ok: true, measuredAt: now.toISOString() };
  const iso = datePartsToIso(parts.day, parts.month, parts.year);
  const date = iso ? parseCalendarDate(iso) : null;
  if (!date) return { ok: false, error: 'date' };
  if (compareCalendarDates(date, todayInIndia(now)) > 0) return { ok: false, error: 'dateFuture' };
  const birth = parseCalendarDate(dateOfBirth);
  if (birth && compareCalendarDates(date, birth) < 0) return { ok: false, error: 'dateBeforeBirth' };
  const startOfDayIst = Date.UTC(date.year, date.month - 1, date.day) - IST_OFFSET_MS;
  return { ok: true, measuredAt: new Date(startOfDayIst).toISOString() };
}
