import type { MeasurementUnit, ScreeningMeasurementType } from '@balswasthya/shared-contracts';
import { AppError } from '../../utils/AppError';

/**
 * Measurement data-entry rules (Step 6 decisions I, J).
 *
 * These are DATA-QUALITY rules only, never clinical thresholds. Nothing here classifies a child:
 *  - units: the value is stored EXACTLY as entered, with its unit; conversion is explicit and
 *    used only for display and for the plausibility check;
 *  - precision: never more decimals than the unit allows (the database keeps 2 decimals, so a
 *    third decimal would otherwise be silently rounded - refused instead);
 *  - plausibility: rejects only values that are physically impossible for a child.
 *
 * !!! ASSUMPTION - PENDING PROGRAMME APPROVAL: the precision per unit and the plausibility limits
 * below were chosen by the engineering team as deliberately wide technical bounds. They must be
 * replaced by programme-approved data-quality ranges (docs/step-6/clinical-content-governance.md).
 */
export const MEASUREMENT_RULES_VERSION =
  'MEASUREMENT_DATA_QUALITY_V1 (ASSUMPTION - pending programme approval)';

export const UNITS_BY_TYPE: Record<ScreeningMeasurementType, readonly MeasurementUnit[]> = {
  WEIGHT: ['kg', 'g'],
  HEIGHT: ['cm', 'mm'],
  LENGTH: ['cm', 'mm'],
  MUAC: ['cm', 'mm'],
  HEAD_CIRCUMFERENCE: ['cm', 'mm'],
};

/** Maximum decimals accepted per unit (never more than the column's 2). */
export const MAX_DECIMALS: Record<MeasurementUnit, number> = { kg: 2, g: 0, cm: 1, mm: 0 };

/** Display / comparison unit per type. */
const CANONICAL_UNIT: Record<ScreeningMeasurementType, 'kg' | 'cm'> = {
  WEIGHT: 'kg',
  HEIGHT: 'cm',
  LENGTH: 'cm',
  MUAC: 'cm',
  HEAD_CIRCUMFERENCE: 'cm',
};

/** Physically impossible outside these (canonical units). Wide on purpose; NOT clinical ranges. */
export const PLAUSIBLE_RANGE: Record<ScreeningMeasurementType, { min: string; max: string }> = {
  WEIGHT: { min: '0.2', max: '250' },
  HEIGHT: { min: '20', max: '250' },
  LENGTH: { min: '20', max: '250' },
  MUAC: { min: '3', max: '60' },
  HEAD_CIRCUMFERENCE: { min: '15', max: '80' },
};

// ------------------------------------------------------------ exact decimal arithmetic

/** A non-negative decimal as integer digits + scale: 12.35 = { digits: 1235n, scale: 2 }. */
interface Decimal {
  digits: bigint;
  scale: number;
}

const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

export function parseDecimal(value: string): Decimal | null {
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? '';
  return { digits: BigInt(match[1]! + fraction), scale: fraction.length };
}

export function decimalPlaces(value: string): number {
  return parseDecimal(value)?.scale ?? 0;
}

function toScale(d: Decimal, scale: number): bigint {
  return d.digits * 10n ** BigInt(scale - d.scale);
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const [x, y] = [toScale(a, scale), toScale(b, scale)];
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Plain string without trailing fractional zeros ("12.500" -> "12.5", "3.0" -> "3"). */
export function formatDecimal(d: Decimal): string {
  const s = d.digits.toString().padStart(d.scale + 1, '0');
  if (d.scale === 0) return s;
  const whole = s.slice(0, s.length - d.scale);
  const fraction = s.slice(s.length - d.scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Powers of ten between units of the same dimension: value_in_to = value_in_from * 10^exp. */
const UNIT_EXPONENT: Record<MeasurementUnit, { dimension: 'mass' | 'length'; exp: number }> = {
  kg: { dimension: 'mass', exp: 3 }, // relative to g
  g: { dimension: 'mass', exp: 0 },
  cm: { dimension: 'length', exp: 1 }, // relative to mm
  mm: { dimension: 'length', exp: 0 },
};

/**
 * Exact unit conversion (no floating point). Throws for units of different dimensions. Examples:
 * 3250 g -> 3.25 kg; 2.5 kg -> 2500 g; 125 mm -> 12.5 cm; 0.5 cm -> 5 mm.
 */
export function convertDecimal(value: string, from: MeasurementUnit, to: MeasurementUnit): string {
  const d = parseDecimal(value);
  if (!d) throw new Error('Not a decimal value');
  const [f, t] = [UNIT_EXPONENT[from], UNIT_EXPONENT[to]];
  if (f.dimension !== t.dimension) throw new Error(`Cannot convert ${from} to ${to}`);
  const shift = f.exp - t.exp;
  const converted =
    shift >= 0
      ? { digits: d.digits * 10n ** BigInt(shift), scale: d.scale }
      : { digits: d.digits, scale: d.scale - shift };
  return formatDecimal(converted);
}

export function toDisplayUnit(type: ScreeningMeasurementType, value: string, unit: MeasurementUnit) {
  const target = CANONICAL_UNIT[type];
  return { value: convertDecimal(value, unit, target), unit: target };
}

// ------------------------------------------------------------------------ validation

function invalid(code: string, message: string, field = 'value'): AppError {
  return AppError.unprocessable(code, message, { field });
}

/** Checks a measurement as entered. Throws 422 with a specific code; never adjusts the value. */
export function validateMeasurement(input: {
  type: ScreeningMeasurementType;
  value: string;
  unit: MeasurementUnit;
  measuredAt: Date;
  now: Date;
  /** Earliest possible instant: the start of the birth date (India). */
  notBefore: Date;
}): void {
  if (!UNITS_BY_TYPE[input.type].includes(input.unit)) {
    throw invalid('INVALID_UNIT', `Unit ${input.unit} is not allowed for ${input.type}`, 'unit');
  }
  const d = parseDecimal(input.value);
  if (!d) throw invalid('INVALID_NUMBER', 'The value is not a valid number');
  if (d.scale > MAX_DECIMALS[input.unit]) {
    throw invalid(
      'TOO_MANY_DECIMALS',
      `At most ${MAX_DECIMALS[input.unit]} decimal places are allowed in ${input.unit}`,
    );
  }
  const canonical = parseDecimal(toDisplayUnit(input.type, input.value, input.unit).value)!;
  const range = PLAUSIBLE_RANGE[input.type];
  if (
    compareDecimal(canonical, parseDecimal(range.min)!) < 0 ||
    compareDecimal(canonical, parseDecimal(range.max)!) > 0
  ) {
    throw invalid(
      'IMPLAUSIBLE_VALUE',
      'This value is not physically possible. Check the number and the unit.',
    );
  }
  // Clock tolerance for devices whose time is slightly ahead.
  if (input.measuredAt.getTime() > input.now.getTime() + 5 * 60_000) {
    throw invalid('MEASURED_IN_FUTURE', 'The measurement time cannot be in the future', 'measuredAt');
  }
  if (input.measuredAt.getTime() < input.notBefore.getTime()) {
    throw invalid('MEASURED_BEFORE_BIRTH', 'The measurement time is before the date of birth', 'measuredAt');
  }
}
