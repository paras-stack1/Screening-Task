import { measuredAtFor } from '../../src/features/screening/measurementDate';

/** Step 6F: the measurement date for values from a card or a guardian. */
const NOW = new Date('2026-11-23T06:00:00.000Z'); // 11:30 IST on 23 Nov
const DOB = '2024-02-29';
const parts = (day: string, month: string, year: string) => ({ day, month, year });

describe('measurement date', () => {
  it('uses the time of entry for a value measured now (date boxes ignored)', () => {
    expect(measuredAtFor('MEASURED', parts('', '', ''), DOB, NOW)).toEqual({
      ok: true,
      measuredAt: NOW.toISOString(),
    });
  });

  it('stores an entered date as the start of that day in India - no invented time', () => {
    // 15 Oct 2026 00:00 IST = 14 Oct 2026 18:30 UTC.
    expect(measuredAtFor('FROM_RECORD', parts('15', '10', '2026'), DOB, NOW)).toEqual({
      ok: true,
      measuredAt: '2026-10-14T18:30:00.000Z',
    });
  });

  it('accepts today and the date of birth itself', () => {
    expect(measuredAtFor('GUARDIAN_REPORTED', parts('23', '11', '2026'), DOB, NOW).ok).toBe(true);
    expect(measuredAtFor('GUARDIAN_REPORTED', parts('29', '2', '2024'), DOB, NOW).ok).toBe(true);
  });

  it.each([
    [parts('', '', ''), 'date'],
    [parts('31', '2', '2026'), 'date'],
    [parts('29', '2', '2025'), 'date'], // not a leap year
    [parts('1', '1', '26'), 'date'], // two-digit year
    [parts('24', '11', '2026'), 'dateFuture'],
    [parts('28', '2', '2024'), 'dateBeforeBirth'],
  ] as const)('rejects %j with %s', (input, error) => {
    expect(measuredAtFor('FROM_RECORD', input, DOB, NOW)).toEqual({ ok: false, error });
  });

  it('judges "future" by the India date, not the UTC date', () => {
    // 20:00 UTC on 23 Nov = 01:30 IST on 24 Nov: 24 Nov is already "today" in India.
    const lateUtc = new Date('2026-11-23T20:00:00.000Z');
    expect(measuredAtFor('FROM_RECORD', parts('24', '11', '2026'), DOB, lateUtc).ok).toBe(true);
  });
});
