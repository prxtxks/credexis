/**
 * Money display helpers (M6.4) — pure STRING operations, no arithmetic
 * (Iron Law #3: the client renders, it never computes). Exact at any
 * magnitude because no value ever becomes a float.
 */

/** Integer-cent string → "$1,234.56". */
export function formatCents(cents: string): string {
  const negative = cents.startsWith("-");
  const digits = negative ? cents.slice(1) : cents;
  const padded = digits.padStart(3, "0");
  const dollars = padded.slice(0, -2);
  const withCommas = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${withCommas}.${padded.slice(-2)}`;
}

/** Human dollars input → integer-cent string, or null when malformed. */
export function parseDollarsInput(input: string): string | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  const cents = `${whole}${frac.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  return `${sign}${cents}`;
}

/** Fixed-point mantissa at a scale → display string; pure string work. */
export function formatRatio(mantissa: string, scale: number): string {
  const neg = mantissa.startsWith("-");
  const digits = neg ? mantissa.slice(1) : mantissa;
  const padded = digits.padStart(scale + 1, "0");
  const head = padded.slice(0, padded.length - scale) || "0";
  const tail = scale > 0 ? `.${padded.slice(padded.length - scale)}` : "";
  return `${neg ? "-" : ""}${head}${tail}`;
}

/** Integer micro-USD string → "$1.23" display; pure string work. */
export function formatMicroUsd(microUsd: string): string {
  const neg = microUsd.startsWith("-");
  const digits = (neg ? microUsd.slice(1) : microUsd).padStart(7, "0");
  const dollars = digits.slice(0, -6);
  const frac = digits.slice(-6, -4); // 2dp display
  const withCommas = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${withCommas}.${frac}`;
}
