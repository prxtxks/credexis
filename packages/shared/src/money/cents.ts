/**
 * Integer-cents money (Iron Law #2). Money is a branded `bigint` — never a
 * `number`. Because `Cents` is a bigint, assigning a float to it or mixing it
 * with a `number` in arithmetic is a TypeScript *compile* error, which is what
 * makes `0.1 + 0.2` class bugs structurally impossible.
 *
 * All arithmetic goes through the helpers here (never raw operators) so the
 * rounding policy stays centralized — enforced at lint time by the custom
 * `money/no-raw-money-arithmetic` rule.
 */

declare const centsBrand: unique symbol;

/** A monetary amount in integer cents. The ONLY representation of money. */
export type Cents = bigint & { readonly [centsBrand]: never };

/** Zero dollars. */
export const ZERO_CENTS: Cents = 0n as Cents;

/** Wrap a bigint as `Cents`. bigints are always integral, so this is total. */
export function cents(value: bigint): Cents {
  return value as Cents;
}

/** Read the underlying bigint out of `Cents` (internal unwrap). */
function raw(value: Cents): bigint {
  return value as bigint;
}

export function addCents(a: Cents, b: Cents): Cents {
  return (raw(a) + raw(b)) as Cents;
}

export function subCents(a: Cents, b: Cents): Cents {
  return (raw(a) - raw(b)) as Cents;
}

export function negateCents(a: Cents): Cents {
  return -raw(a) as Cents;
}

export function absCents(a: Cents): Cents {
  const v = raw(a);
  return (v < 0n ? -v : v) as Cents;
}

/** Multiply money by an integer count (e.g. months). Exact — no rounding. */
export function mulCentsByInt(a: Cents, factor: bigint): Cents {
  return (raw(a) * factor) as Cents;
}

/**
 * Scale money by a rational factor (numerator/denominator) with banker's
 * rounding — e.g. 10% equity injection is `mulCentsByRatio(amount, 10n, 100n)`.
 */
export function mulCentsByRatio(a: Cents, numerator: bigint, denominator: bigint): Cents {
  return divRoundHalfEven(raw(a) * numerator, denominator) as Cents;
}

export function sumCents(values: readonly Cents[]): Cents {
  let acc = 0n;
  for (const v of values) {
    acc += raw(v);
  }
  return acc as Cents;
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareCents(a: Cents, b: Cents): -1 | 0 | 1 {
  const av = raw(a);
  const bv = raw(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

export function eqCents(a: Cents, b: Cents): boolean {
  return compareCents(a, b) === 0;
}

export function ltCents(a: Cents, b: Cents): boolean {
  return compareCents(a, b) < 0;
}

export function lteCents(a: Cents, b: Cents): boolean {
  return compareCents(a, b) <= 0;
}

export function gtCents(a: Cents, b: Cents): boolean {
  return compareCents(a, b) > 0;
}

export function gteCents(a: Cents, b: Cents): boolean {
  return compareCents(a, b) >= 0;
}

/**
 * Integer division with round-half-to-even (banker's rounding). The single
 * rounding primitive for the whole system — every money/ratio rounding routes
 * through here so drift (post-mortem trap #5) cannot creep in.
 */
export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError("divRoundHalfEven: division by zero");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const twiceRemainder = remainder * 2n;

  let rounded = quotient;
  if (twiceRemainder > d) {
    rounded = quotient + 1n;
  } else if (twiceRemainder === d && quotient % 2n === 1n) {
    // Exactly half → round to the even neighbour.
    rounded = quotient + 1n;
  }
  return negative ? -rounded : rounded;
}

/** Format money as a US-dollar string, e.g. `-$1,234.56`. Display only. */
export function formatCentsUSD(value: Cents): string {
  const v = raw(value);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const dollars = abs / 100n;
  const remainder = abs % 100n;
  const centsPart = remainder.toString().padStart(2, "0");
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${centsPart}`;
}
