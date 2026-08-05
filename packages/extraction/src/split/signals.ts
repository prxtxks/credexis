/**
 * Deterministic page signals (M3.5, Blueprint §4.1): IRS form numbers and
 * OMB control numbers are printed with high regularity - they are checked
 * FIRST, before any LLM sees a page (deterministic beats probabilistic,
 * Iron Law #1 spirit).
 *
 * A deterministic hit SKIPS the LLM entirely (classify.ts), so a false
 * positive here is a high-confidence wrong answer nothing reviews. Three
 * invariants keep that from happening (2026-07-30 adversarial review):
 *
 * 1. IDENTITY IS A TOKEN, NOT A PHRASE. Only the printed form number
 *    ("Form 1125-E", "Schedule K-1 (Form 1065)") classifies at form tier.
 *    Generic accounting phrases were removed as signals after two live
 *    misfiles: "Compensation of officers" is line 7 of the 1120-S itself
 *    (the parent classified as its own attachment at 0.98), and
 *    "Depreciation and amortization" is an expense line on every CPA P&L
 *    (statements classified as Form 4562 at 0.9).
 * 2. IDENTITY LIVES IN THE HEADER. Tokens only count within the first
 *    HEADER_WINDOW chars of the page text - forms and continuation pages
 *    print their number at the top; a token deep in body text is prose.
 * 3. A CITATION IS NOT AN IDENTITY. "(attach Form 4562)", "from Form
 *    1125-E" are references parents print about their attachments; a token
 *    preceded by a reference verb never classifies.
 *
 * Ordering still matters and is load-bearing:
 * - K-1 pages contain the parent form's number ("Schedule K-1 (Form 1120-S)")
 *   → K-1 patterns run before plain form patterns.
 * - An 1120-S continuation page titled "Schedule L - Balance Sheets per
 *   Books" must NOT classify as a BALANCE_SHEET statement → statement
 *   keywords run only when no IRS signal fired.
 *
 * Degraded OCR that garbles the header now falls through to the LLM or to
 * `unresolved` instead of keyword-guessing - abstention over false
 * confidence is the designed trade for underwriting.
 */

import type { FormFamily } from "@credexis/schema";

export interface PageSignals {
  formFamily: FormFamily | null;
  taxYear: number | null;
  /** True when the page bears page-1 markers (form header + OMB). */
  isDocumentStart: boolean;
  /** Printed continuation page number ("Page 3"), if any. */
  continuationPage: number | null;
  /** 0..1 — how strongly the deterministic evidence supports formFamily. */
  confidence: number;
  /** Human-auditable list of what matched. */
  matched: string[];
}

/** Ordered — first hit wins. Most-specific patterns first.
 *  Form-number tokens only; distinctive multi-word TITLES are kept as
 *  alternates only where no parent prints them as a line label (the
 *  1040-schedule titles, the 8825 title, the W-2 title). */
const IRS_FORM_PATTERNS: ReadonlyArray<[RegExp, FormFamily, string]> = [
  [/schedule\s+k-?1\s*\(form\s+1120-?s\)(?!,?\s*box)/i, "K1_1120S", "k1-1120s"],
  [/schedule\s+k-?1\s*\(form\s+1065\)(?!,?\s*box)/i, "K1_1065", "k1-1065"],
  // 2019-era revisions print "(Form 1040 or 1040-SR)" - the sweep caught
  // those pages falling through to the bare-1040 pattern (corpus-1).
  [
    /schedule\s+c\s*\(form\s+1040(?:\s+or\s+1040-?sr)?\)|profit or loss from business/i,
    "1040_SCH_C",
    "sch-c",
  ],
  [
    /schedule\s+e\s*\(form\s+1040(?:\s+or\s+1040-?sr)?\)|supplemental income and loss/i,
    "1040_SCH_E",
    "sch-e",
  ],
  [
    /schedule\s+f\s*\(form\s+1040(?:\s+or\s+1040-?sr)?\)|profit or loss from farming/i,
    "1040_SCH_F",
    "sch-f",
  ],
  [/schedule\s+1\s*\(form\s+1040(?:\s+or\s+1040-?sr)?\)/i, "1040_SCH_1", "sch-1"],
  // Token only — "Compensation of officers" is 1120-S line 7 / 1120 line 12
  // (false-confidence probe, 2026-07-30).
  [/form\s+1125-?e\b/i, "1125E", "1125e"],
  [/form\s+8825\b|rental real estate income and expenses of a partnership/i, "8825", "8825"],
  // Token only — "Depreciation and amortization" is a P&L expense line
  // (false-confidence probe, 2026-07-30).
  [/form\s+4562(?![\d-])/i, "4562", "4562"],
  // Known-but-unsupported (M13.1): the corporate AMT form rides along in
  // real 1120 filings. Labelling it deterministically keeps its seven
  // pages out of the LLM, which used to relabel them 4562/1120.
  [/form\s+4626(?![\d-])/i, "4626", "4626"],
  // Suffix lookaheads: "Form 1120-F"/"1120-H"/"1040-NR" are DIFFERENT,
  // unsupported forms and must abstain - a 42-page 1120-F classified as
  // 1120 at 0.98 before the sweep caught it (corpus-1). 1040-SR is the
  // same form family (seniors' print) and stays a 1040. Sibling suffixes
  // are always DASHED (or the bare S) - a glued LETTER is the text layer
  // fusing columns ("Form 1120Department of the Treasury", ats-1120-s12
  // p2) and must still match; rejecting all letters made the detector
  // abstain on real 1120 headers (M13.1 finding).
  [/form\s+1120-?s(?!f)(?![\d-])/i, "1120S", "1120s"],
  [/form\s+1120(?!-?s\b)(?![\d-])(?!-[a-z])/i, "1120", "1120"],
  [/form\s+1065(?![\d-])(?!-[a-z])/i, "1065", "1065"],
  // Title only — "Attach Form(s) W-2" references on 1040s must not match
  // (real-doc regression, 2026-07-19).
  [/wage and tax statement/i, "W2", "w2"],
  [/form\s+1040(?:-?sr)?(?![\d-])(?!-[a-z])(?!(?:a|ez)\b)/i, "1040", "1040"],
];

/** Identity lives at the top of the page: real forms and their continuation
 *  pages print the form number in the header block. Body text mentioning a
 *  form ("we prepared Form 1120-S") is prose, not identity. */
const HEADER_WINDOW = 400;

/** "(attach Form 4562)", "Attach to Schedule M-3 for Form 1065", "File
 *  electronically with Form 1120", "Refer to the Form 1040 instructions" —
 *  documents cite OTHER forms constantly; a cited token never classifies.
 *  Prepositions and articles are in the guard because identity headers
 *  never lead their own form number with one - every phrasing here was
 *  captured verbatim from the IRS corpus sweep (corpus-1, 2026-07-30).
 *  Checked against the ~24 chars before a token match. */
const REFERENCE_CONTEXT_RE =
  /\b(?:attach(?:ed|ment)?s?|from|see|per|refer(?:red)?|to|on|in|of|for|about|the|your|with|includes?|included|reported|shown|enter(?:ed)?|filed?)[\s(:.,]*$/i;

/** First non-cited token match inside the header window, in pattern order. */
function findAnchoredFormSignal(text: string): { family: FormFamily; label: string } | null {
  const header = text.slice(0, HEADER_WINDOW);
  for (const [re, family, label] of IRS_FORM_PATTERNS) {
    const m = re.exec(header);
    if (!m) continue;
    const before = header.slice(Math.max(0, m.index - 24), m.index);
    if (REFERENCE_CONTEXT_RE.test(before)) continue; // citation, not identity
    return { family, label };
  }
  return null;
}

/** OMB control numbers — unique ones classify alone; shared ones corroborate. */
const OMB_RE = /omb\s+no\.?\s*(1545-\d{4})/i;
const OMB_UNIQUE: Readonly<Record<string, FormFamily>> = {
  "1545-0008": "W2",
  // The current W-2 revision carries the W-2/W-3 series number instead -
  // the corpus sweep caught every current-revision W-2 page abstaining
  // (corpus-1, 2026-07-30). The printed title sits at the BOTTOM of a W-2,
  // outside any header window, so the OMB number is the working signal.
  "1545-0029": "W2",
};
/** Shared OMBs corroborate only their own form group (real-doc
 * regression: 1545-0074 must never boost a W-2 misread to 0.98). */
const OMB_CORROBORATING: Readonly<Record<string, readonly FormFamily[]>> = {
  "1545-0123": ["1120", "1120S", "1065", "1125E", "8825", "K1_1120S", "K1_1065", "4626"],
  "1545-0074": ["1040", "1040_SCH_1", "1040_SCH_C", "1040_SCH_E", "1040_SCH_F"],
};

/** Statement keywords — consulted ONLY when no IRS signal fired. */
const STATEMENT_PATTERNS: ReadonlyArray<[RegExp, FormFamily, string]> = [
  // DEBT_SCHEDULE first (Golden Deal 1, 2026-08-04): the standard bank
  // debt-schedule template says "should match the current balance sheet",
  // so the generic "balance sheet" keyword must not get first claim. A
  // balance sheet never says "debt schedule"; the reverse is routine.
  [/debt schedule|schedule of (?:liabilities|debts|loans)/i, "DEBT_SCHEDULE", "debt-keyword"],
  [/profit\s*(?:and|&)\s*loss|income statement|statement of operations/i, "PNL", "pnl-keyword"],
  [/balance sheet/i, "BALANCE_SHEET", "bs-keyword"],
];

/** A page that bears IRS print markers is an IRS form page. If the form
 *  tier abstained on it, the statement keywords must NOT guess - an
 *  unsupported 1120-F's "Schedule L - Balance Sheets per Books" is not a
 *  CPA balance sheet (corpus-1 sweep finding). The LLM/review tier owns
 *  those pages. Freeform CPA statements carry none of these markers. */
const IRS_MARKER_RE = /\bform\s+\d{3,4}[a-z0-9-]*\b|\bomb\s+no\.|\bschedule\s+[a-z0-9-]+\s*\(form/i;

const CONTINUATION_RE = /(?:^|\s)page\s+([2-9]\d?)(?:\s|$)/i;
const TAX_YEAR_RES = [
  /(?:calendar year|tax year|for the year|year beginning)\D{0,20}(20[12]\d)/i,
  /(20[12]\d)[,.]?\s+(?:ending|or tax year)/i,
];

export function detectPageSignals(text: string): PageSignals {
  const matched: string[] = [];
  let formFamily: FormFamily | null = null;
  let confidence = 0;

  // 1. IRS form tokens — header-anchored, citation-guarded, first hit wins.
  const anchored = findAnchoredFormSignal(text);
  if (anchored) {
    formFamily = anchored.family;
    confidence = 0.9;
    matched.push(`form:${anchored.label}`);
  }

  // 2. OMB number — unique ones classify, shared ones corroborate.
  const omb = OMB_RE.exec(text)?.[1];
  if (omb) {
    matched.push(`omb:${omb}`);
    const unique = OMB_UNIQUE[omb];
    if (
      formFamily !== null &&
      ((OMB_CORROBORATING[omb]?.includes(formFamily) ?? false) || unique === formFamily)
    ) {
      confidence = 0.98;
    } else if (formFamily === null && unique) {
      formFamily = unique;
      confidence = 0.95;
    }
  }

  // 3. Statement keywords — only in the absence of any IRS signal, and
  //    never on a page with IRS print markers (see IRS_MARKER_RE).
  if (formFamily === null && !IRS_MARKER_RE.test(text)) {
    for (const [re, family, label] of STATEMENT_PATTERNS) {
      if (re.test(text)) {
        formFamily = family;
        confidence = 0.75; // freeform docs: keywords are weaker evidence
        matched.push(label);
        break;
      }
    }
  }

  // 4. Tax year (header region first, then anywhere via explicit phrasing).
  let taxYear: number | null = null;
  for (const re of TAX_YEAR_RES) {
    const m = re.exec(text);
    if (m?.[1]) {
      taxYear = Number(m[1]);
      matched.push(`year:${taxYear}`);
      break;
    }
  }

  // 5. Continuation vs document start.
  const contMatch = CONTINUATION_RE.exec(text);
  const continuationPage = contMatch?.[1] ? Number(contMatch[1]) : null;
  if (continuationPage !== null) matched.push(`page:${continuationPage}`);
  const isDocumentStart = formFamily !== null && omb !== undefined && continuationPage === null;

  return { formFamily, taxYear, isDocumentStart, continuationPage, confidence, matched };
}

/* ── Token evidence for the LLM fallback (M13.1) ─────────────────────── */

/** How a family's printed token appears on a page's text layer. */
export type TokenEvidence = "anchored" | "unanchored" | "cited-only" | "absent";

/**
 * Evidence check the LLM classifier's claims are validated against
 * (classify.ts). The first-deal walkthrough showed the vision model
 * reading "attach Form 1125-E" on an 1120 page 1 as an identity - the
 * exact bug class #177 closed in the regex path. This helper exposes the
 * same vocabulary so the LLM path can veto a claim whose only textual
 * basis is a citation:
 *
 * - "anchored"   the token appears non-cited in the header window - the
 *                deterministic layer's own standard of identity
 * - "unanchored" a non-cited token exists, but outside the header window
 * - "cited-only" every occurrence is preceded by a reference verb - the
 *                page talks ABOUT the form; claiming it IS the form is
 *                the 1125-E bug
 * - "absent"     the text layer never mentions the token (image-only
 *                evidence - a garbled scan, a graphical header; the
 *                vision model's claim stands on the image)
 */
export function familyTokenEvidence(text: string, family: FormFamily): TokenEvidence {
  const patterns = IRS_FORM_PATTERNS.filter(([, f]) => f === family);
  if (patterns.length === 0) return "absent"; // statements etc. have no token
  let sawCited = false;
  let sawUnanchored = false;
  for (const [re] of patterns) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(global)) {
      const idx = m.index ?? 0;
      const before = text.slice(Math.max(0, idx - 24), idx);
      if (REFERENCE_CONTEXT_RE.test(before)) {
        sawCited = true;
      } else if (idx < HEADER_WINDOW) {
        return "anchored";
      } else {
        sawUnanchored = true;
      }
    }
  }
  if (sawUnanchored) return "unanchored";
  return sawCited ? "cited-only" : "absent";
}
