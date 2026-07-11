/**
 * The number normalizer (M3.6, Blueprint §4.4) — the ONE place raw value
 * text becomes integer cents. Every extraction path funnels through here;
 * no stage parses numbers on its own.
 *
 * Contract:
 * - Input is ONE value's text (column separation is geometric — post-mortem
 *   trap 6: this module never sees two values welded together and never
 *   performs digit-space surgery across values).
 * - Output is branded integer cents (Iron Law #2), an explicit null (the
 *   field is present but empty — dash/N-A), or a typed rejection routed to
 *   review. IEEE floats never touch the value at any point.
 *
 * Separator rules (deterministic, in priority order):
 * 1. Both "." and "," present → the LAST occurring separator is the decimal
 *    mark; the other is grouping ("1,020.64" US, "1.020,64" EU).
 * 2. Only "," present: multiple commas → grouping. A single comma followed
 *    by exactly 3 digits → grouping ("1,020" = 1020). Followed by 1–2
 *    digits → decimal comma ("10,50" = 10.50).
 * 3. Only "." present: multiple dots → grouping ("1.234.567"). A single dot
 *    followed by 1–2 digits → decimal ("10.50"). A single dot followed by
 *    exactly 3 digits ("1.020") is AMBIGUOUS (US: 1.02; EU: 1020) →
 *    rejected to review. Trailing dot ("1,234.") → whole number.
 * 4. Space/apostrophe groups ("10 000", "1'000") → grouping.
 */

import { cents, type Cents } from "../money/cents.js";

export type NormalizeResult =
  | { ok: true; cents: Cents }
  | { ok: true; cents: null; nullReason: "dash" | "empty" | "na" }
  | { ok: false; reason: NormalizeRejection; input: string };

export type NormalizeRejection =
  | "ambiguous_separator"
  | "too_many_decimals"
  | "malformed_grouping"
  | "not_a_number"
  | "conflicting_signs"
  | "invalid_cents_box";

export interface NormalizeOptions {
  /**
   * Statement-level unit scaling ("in thousands"), detected by M5.3 —
   * multiplies the parsed value. 1 | 1_000 | 1_000_000.
   */
  scale?: 1 | 1_000 | 1_000_000;
  /**
   * IRS cents-box companion cell: the main text is whole dollars and this
   * holds 0–2 digits of cents (possibly "--"/"00"/""). Only meaningful for
   * registry fields flagged as having a cents box.
   */
  centsBox?: string;
}

/** Explicit-absence markers (null ≠ zero — Blueprint §4.4). */
const NA_RE = /^(n\/?a|none|nil)$/i;
const DASH_RE = /^[-–—−]+$/;

const CURRENCY_RE = /[$€£]/g;
/** All whitespace incl. NBSP/thin/narrow variants that OCR emits. */
const SPACE_RE = /[\s\u00a0\u2000-\u200b\u202f\u205f]+/g;

function digitsToCents(intDigits: string, decDigits: string, negative: boolean): bigint {
  const whole = BigInt(intDigits === "" ? "0" : intDigits);
  const frac = BigInt(decDigits.padEnd(2, "0") || "0");
  const value = whole * 100n + frac;
  return negative ? -value : value;
}

const GROUP_3_RE = /^\d{1,3}(?:\.\d{3})+$|^\d{1,3}(?:,\d{3})+$|^\d{1,3}(?:'\d{3})+$/;

/**
 * Normalize one value's raw text to integer cents.
 * `normalizeAmount("(1,020.64)")` → -102064¢.
 */
export function normalizeAmount(raw: string, opts: NormalizeOptions = {}): NormalizeResult {
  const scale = BigInt(opts.scale ?? 1);
  let text = raw.trim();

  // ── Null vs zero ───────────────────────────────────────────────────────
  if (text === "") return { ok: true, cents: null, nullReason: "empty" };
  if (DASH_RE.test(text)) return { ok: true, cents: null, nullReason: "dash" };
  if (NA_RE.test(text)) return { ok: true, cents: null, nullReason: "na" };

  // ── Sign markers ───────────────────────────────────────────────────────
  // Extracted in a loop so any nesting order is seen ("-(500)", "(500)-"):
  // more than one marker on a single value is contradictory → review.
  let signs = 0;
  for (let changed = true; changed; ) {
    changed = false;
    const paren = /^\((.*)\)$/.exec(text);
    if (paren?.[1] !== undefined) {
      signs++;
      text = paren[1].trim();
      changed = true;
      continue;
    }
    if (/^[-–—−]/.test(text) && !DASH_RE.test(text)) {
      signs++;
      text = text.replace(/^[-–—−]\s*/, "");
      changed = true;
      continue;
    }
    if (/[-–—−]$/.test(text) && !DASH_RE.test(text)) {
      signs++;
      text = text.replace(/\s*[-–—−]$/, "");
      changed = true;
    }
  }
  if (signs > 1) return { ok: false, reason: "conflicting_signs", input: raw };
  const negative = signs === 1;

  // ── Strip currency + unify spaces ─────────────────────────────────────
  text = text.replace(CURRENCY_RE, "").trim();

  // Space/apostrophe-grouped integers: "10 000" / "1'000" (post-OCR).
  const spaceGrouped = text.replace(SPACE_RE, " ");
  if (/^\d{1,3}(?: \d{3})+$/.test(spaceGrouped) || /^\d{1,3}(?:'\d{3})+$/.test(spaceGrouped)) {
    text = spaceGrouped.replace(/[ ']/g, "");
  } else {
    text = text.replace(SPACE_RE, "");
  }

  if (text === "") return { ok: false, reason: "not_a_number", input: raw };
  if (!/^[\d.,']+$/.test(text)) return { ok: false, reason: "not_a_number", input: raw };

  // ── Cents box (IRS forms) ─────────────────────────────────────────────
  let centsBoxDigits: string | null = null;
  if (opts.centsBox !== undefined) {
    const box = opts.centsBox.trim();
    if (box === "" || DASH_RE.test(box)) {
      centsBoxDigits = "00";
    } else if (/^\d{1,2}$/.test(box)) {
      centsBoxDigits = box.padStart(2, "0");
    } else {
      return { ok: false, reason: "invalid_cents_box", input: raw };
    }
  }

  // ── Separator resolution ──────────────────────────────────────────────
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let intPart: string;
  let decPart = "";

  if (lastDot !== -1 && lastComma !== -1) {
    // Rule 1: both present — later one is the decimal mark.
    const decPos = Math.max(lastDot, lastComma);
    const groupChar = decPos === lastDot ? "," : ".";
    intPart = text.slice(0, decPos).split(groupChar).join("");
    decPart = text.slice(decPos + 1);
    if (intPart.includes(".") || intPart.includes(",")) {
      return { ok: false, reason: "malformed_grouping", input: raw };
    }
  } else if (lastComma !== -1) {
    // Rule 2: comma only.
    const commas = text.split(",").length - 1;
    const after = text.slice(lastComma + 1);
    if (commas > 1 || GROUP_3_RE.test(text)) {
      if (!GROUP_3_RE.test(text)) return { ok: false, reason: "malformed_grouping", input: raw };
      intPart = text.split(",").join("");
    } else if (/^\d{1,2}$/.test(after)) {
      intPart = text.slice(0, lastComma);
      decPart = after;
    } else if (after === "") {
      intPart = text.slice(0, lastComma); // "1,234," → trailing separator
    } else {
      return { ok: false, reason: "malformed_grouping", input: raw };
    }
  } else if (lastDot !== -1) {
    // Rule 3: dot only.
    const dots = text.split(".").length - 1;
    const after = text.slice(lastDot + 1);
    if (dots > 1) {
      if (!GROUP_3_RE.test(text)) return { ok: false, reason: "malformed_grouping", input: raw };
      intPart = text.split(".").join("");
    } else if (after === "") {
      intPart = text.slice(0, lastDot); // "1234." → whole number
    } else if (/^\d{3}$/.test(after) && /^\d{1,3}$/.test(text.slice(0, lastDot))) {
      return { ok: false, reason: "ambiguous_separator", input: raw }; // "1.020"
    } else if (/^\d{1,2}$/.test(after)) {
      intPart = text.slice(0, lastDot);
      decPart = after;
    } else {
      return { ok: false, reason: "too_many_decimals", input: raw }; // "1.2345"
    }
  } else {
    intPart = text;
  }

  if (intPart.includes("'")) intPart = intPart.split("'").join("");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) {
    return { ok: false, reason: "not_a_number", input: raw };
  }
  if (intPart === "" && decPart === "") return { ok: false, reason: "not_a_number", input: raw };
  if (decPart.length > 2) return { ok: false, reason: "too_many_decimals", input: raw };

  // Cents box and inline decimals are mutually exclusive encodings.
  if (centsBoxDigits !== null) {
    if (decPart !== "") return { ok: false, reason: "invalid_cents_box", input: raw };
    decPart = centsBoxDigits;
  }

  const value = digitsToCents(intPart, decPart, negative) * scale;
  return { ok: true, cents: cents(value) };
}
