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
