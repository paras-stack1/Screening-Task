import type { MeasurementUnit, ScreeningMeasurementType } from '@balswasthya/shared-contracts';

/**
 * Data-entry rules for measurements, mirrored from the API so mistakes show before sending (the
 * API decides). Shared by the measurements screen (Step 6C) and the amendment screen (6G-2).
 */
export const MEASUREMENT_UNITS: Record<ScreeningMeasurementType, MeasurementUnit[]> = {
  WEIGHT: ['kg', 'g'],
  HEIGHT: ['cm', 'mm'],
  LENGTH: ['cm', 'mm'],
  MUAC: ['cm', 'mm'],
  HEAD_CIRCUMFERENCE: ['cm', 'mm'],
};

export const MEASUREMENT_MAX_DECIMALS: Record<MeasurementUnit, number> = { kg: 2, g: 0, cm: 1, mm: 0 };

const DECIMAL = /^(0|[1-9]\d{0,5})(\.\d{1,3})?$/;

export type MeasurementValueError = 'unit' | 'value' | 'decimals';

/** Checks a typed value for a unit: a plain decimal, within the unit's precision. */
export function checkMeasurementValue(
  type: ScreeningMeasurementType,
  unit: MeasurementUnit | '',
  raw: string,
): MeasurementValueError | null {
  if (!unit || !MEASUREMENT_UNITS[type].includes(unit)) return 'unit';
  const value = raw.trim();
  if (!DECIMAL.test(value)) return 'value';
  const decimals = value.includes('.') ? value.split('.')[1]!.length : 0;
  return decimals > MEASUREMENT_MAX_DECIMALS[unit] ? 'decimals' : null;
}
