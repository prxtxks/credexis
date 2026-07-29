/**
 * Entity↔document name matching (M11.4, design 02 §3 / synthesis):
 * the DETERMINISTIC half of identity validation. The LLM only LOCATES a
 * printed name (Iron Law #1); deciding whether "John H. Smith" is the
 * deal's "John Smith" happens here, in auditable code — a blended
 * token-set + Jaro-Winkler score with initial awareness, business-suffix
 * normalization, and DBA handling. Pure functions, no I/O.
 *
 * Bands (defaults; operational tuning belongs in tenants.settings later):
 *   ≥ HIGH  → eligible for auto-confirm (band OFF until eval gates run)
 *   ≥ MID   → actionable "Name matches NN% — approve?" notification
 *   < MID   → mismatch → blocking issue
 */

export const NAME_MATCH_BANDS = { high: 0.92, mid: 0.72 } as const;
export type NameMatchBand = "high" | "mid" | "low";

const BUSINESS_SUFFIXES = new Set([
  "llc",
  "inc",
  "corp",
  "corporation",
  "co",
  "ltd",
  "lp",
  "llp",
  "pllc",
  "pc",
  "pa",
  "plc",
  "company",
  "incorporated",
  "limited",
]);

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,'’&]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Jaro-Winkler similarity (standard, prefix scale 0.1, max prefix 4). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array<boolean>(a.length).fill(false);
  const bM = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!bM[j] && a[i] === b[j]) {
        aM[i] = bM[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length) && a[i] === b[i]; i++) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Order-free token alignment: exact > initial-match > best fuzzy. */
function tokenSetScore(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const [small, large] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  const used = new Array<boolean>(large.length).fill(false);
  let total = 0;
  for (const tok of small) {
    let best = 0;
    let bestIdx = -1;
    for (let j = 0; j < large.length; j++) {
      if (used[j]) continue;
      const other = large[j]!;
      let s: number;
      if (tok === other) s = 1;
      else if (tok.length === 1 || other.length === 1)
        s = tok[0] === other[0] ? 0.78 : 0; // initial vs full name → human approves
      else {
        // Fuzzy floor: below 0.8 two name tokens are DIFFERENT names
        // (john/jane ≈ 0.70 must contribute nothing), while true
        // variants (john/jon ≈ 0.93) pass. Never partial credit for a
        // probably-different person.
        const jw = jaroWinkler(tok, other);
        s = jw >= 0.8 ? jw : 0;
      }
      if (s > best) {
        best = s;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) used[bestIdx] = true;
    total += best;
  }
  // Unmatched extra tokens (middle names on one side) cost little; they
  // are evidence of neither match nor mismatch.
  const extraPenalty = (large.length - small.length) * 0.04;
  return Math.max(0, total / small.length - extraPenalty);
}

export interface NameMatch {
  score: number;
  band: NameMatchBand;
}

const band = (score: number): NameMatchBand =>
  score >= NAME_MATCH_BANDS.high ? "high" : score >= NAME_MATCH_BANDS.mid ? "mid" : "low";

/** Person names: order-free tokens with initial awareness. */
export function matchPersonName(a: string, b: string): NameMatch {
  const at = clean(a).split(" ").filter(Boolean);
  const bt = clean(b).split(" ").filter(Boolean);
  const score = tokenSetScore(at, bt);
  return { score, band: band(score) };
}

/** Strip legal suffixes; split DBA segments. */
function businessForms(raw: string): string[][] {
  const segments = clean(raw)
    .split(/\b(?:dba|d b a|doing business as)\b/)
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.map((seg) => seg.split(" ").filter((t) => t && !BUSINESS_SUFFIXES.has(t)));
}

/** Business names: best alignment across DBA segments, suffix-blind. */
export function matchBusinessName(a: string, b: string): NameMatch {
  const aForms = businessForms(a);
  const bForms = businessForms(b);
  let best = 0;
  for (const af of aForms) {
    for (const bf of bForms) {
      best = Math.max(best, tokenSetScore(af, bf));
    }
  }
  return { score: best, band: band(best) };
}
