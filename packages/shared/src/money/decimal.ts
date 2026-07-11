/**
 * Fixed-point decimal for ratios and division results (DSCR, LTV, current
 * ratio). Value = `mantissa / 10^scale`, stored as a bigint mantissa so there
 * is still zero floating point anywhere near the numbers. Division uses the
 * shared banker's-rounding primitive.
 */

import { divRoundHalfEven, type Cents } from "./cents.js";

declare const decimalBrand: unique symbol;

/** A fixed-point decimal: `mantissa / 10^scale`. */
export interface FixedDecimal {
  readonly mantissa: bigint;
  readonly scale: number;
  readonly [decimalBrand]: never;
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`FixedDecimal: scale must be a non-negative integer, got ${scale}`);
  }
}

/** Construct a `FixedDecimal` from a raw mantissa and scale. */
export function makeDecimal(mantissa: bigint, scale: number): FixedDecimal {
  assertScale(scale);
  return { mantissa, scale } as unknown as FixedDecimal;
}

/**
 * Divide two money amounts into a fixed-point ratio at `scale` decimal places
 * with banker's rounding — the DSCR/LTV workhorse. Throws on divide-by-zero.
 */
export function divideCentsToDecimal(
  numerator: Cents,
  denominator: Cents,
  scale: number,
): FixedDecimal {
  assertScale(scale);
  const factor = 10n ** BigInt(scale);
  const mantissa = divRoundHalfEven((numerator as bigint) * factor, denominator as bigint);
  return makeDecimal(mantissa, scale);
}

/** Rescale a decimal to `targetScale` with banker's rounding. */
export function rescaleDecimal(value: FixedDecimal, targetScale: number): FixedDecimal {
  assertScale(targetScale);
  if (targetScale === value.scale) {
    return value;
  }
  if (targetScale > value.scale) {
    const factor = 10n ** BigInt(targetScale - value.scale);
    return makeDecimal(value.mantissa * factor, targetScale);
  }
  const factor = 10n ** BigInt(value.scale - targetScale);
  return makeDecimal(divRoundHalfEven(value.mantissa, factor), targetScale);
}

/** -1 / 0 / 1, comparing values regardless of differing scales. */
export function compareDecimal(a: FixedDecimal, b: FixedDecimal): -1 | 0 | 1 {
  const commonScale = a.scale > b.scale ? a.scale : b.scale;
  const av = rescaleDecimal(a, commonScale).mantissa;
  const bv = rescaleDecimal(b, commonScale).mantissa;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

/** Format as a plain decimal string, e.g. `1.15`, `-0.07`, `42`. Display only. */
export function formatDecimal(value: FixedDecimal): string {
  const negative = value.mantissa < 0n;
  const abs = negative ? -value.mantissa : value.mantissa;
  const sign = negative ? "-" : "";
  if (value.scale === 0) {
    return `${sign}${abs.toString()}`;
  }
  const digits = abs.toString().padStart(value.scale + 1, "0");
  const cut = digits.length - value.scale;
  return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}
