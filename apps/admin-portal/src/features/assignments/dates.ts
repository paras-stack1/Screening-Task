/**
 * Assignment dates are chosen as calendar days in India time and sent as exact instants:
 *  - a first day starts at 00:00 India time of that day (today = "now", omitted);
 *  - a last day means "works until the end of that day": the assignment ends at 00:00 India time
 *    of the FOLLOWING day.
 */
const IST_OFFSET = '+05:30';

/** Today's date in India as YYYY-MM-DD (whatever the computer's time zone). */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function startOfIndianDay(day: string): string {
  return `${day}T00:00:00.000${IST_OFFSET}`;
}

/** effectiveFrom for a chosen first day: omitted (= now) for today or no choice. */
export function effectiveFromFor(firstDay: string | undefined, today: string): string | undefined {
  return firstDay && firstDay > today ? startOfIndianDay(firstDay) : undefined;
}

/** effectiveTo for a chosen last day (end of that day in India), or undefined. */
export function effectiveToFor(lastDay: string | undefined): string | undefined {
  return lastDay ? startOfIndianDay(addDays(lastDay, 1)) : undefined;
}

/** Not revoked and not ended at `now`. */
export function isCurrent(
  assignment: { status: string; effectiveTo: string | null },
  now = new Date(),
): boolean {
  return (
    assignment.status !== 'REVOKED' &&
    (assignment.effectiveTo === null || new Date(assignment.effectiveTo) > now)
  );
}
