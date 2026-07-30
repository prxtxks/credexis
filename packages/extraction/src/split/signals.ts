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
  [/schedule\s+c\s*\(form\s+1040\)|profit or loss from business/i, "1040_SCH_C", "sch-c"],
  [/schedule\s+e\s*\(form\s+1040\)|supplemental income and loss/i, "1040_SCH_E", "sch-e"],
  [/schedule\s+f\s*\(form\s+1040\)|profit or loss from farming/i, "1040_SCH_F", "sch-f"],
  [/schedule\s+1\s*\(form\s+1040\)/i, "1040_SCH_1", "sch-1"],
  // Token only — "Compensation of officers" is 1120-S line 7 / 1120 line 12
  // (false-confidence probe, 2026-07-30).
  [/form\s+1125-?e\b/i, "1125E", "1125e"],
  [/form\s+8825\b|rental real estate income and expenses of a partnership/i, "8825", "8825"],
  // Token only — "Depreciation and amortization" is a P&L expense line
  // (false-confidence probe, 2026-07-30).
  [/form\s+4562\b/i, "4562", "4562"],
  [/form\s+1120-?s\b/i, "1120S", "1120s"],
  [/form\s+1120\b/i, "1120", "1120"],
  [/form\s+1065\b/i, "1065", "1065"],
  // Title only — "Attach Form(s) W-2" references on 1040s must not match
  // (real-doc regression, 2026-07-19).
  [/wage and tax statement/i, "W2", "w2"],
  [/form\s+1040\b/i, "1040", "1040"],
];

/** Identity lives at the top of the page: real forms and their continuation
 *  pages print the form number in the header block. Body text mentioning a
 *  form ("we prepared Form 1120-S") is prose, not identity. */
const HEADER_WINDOW = 400;

/** "(attach Form 4562)", "from Form 1125-E", "See attached Form 4562" —
 *  parents cite their attachments by number; a cited token never
 *  classifies. Checked against the ~24 chars before a token match. */
const REFERENCE_CONTEXT_RE =
  /(?:attach(?:ed|ment)?s?|from|see|per|includes?|included|reported\s+on|shown\s+on|enter(?:ed)?\s+on)[\s(:.,]*$/i;

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
};
/** Shared OMBs corroborate only their own form group (real-doc
 * regression: 1545-0074 must never boost a W-2 misread to 0.98). */
const OMB_CORROBORATING: Readonly<Record<string, readonly FormFamily[]>> = {
  "1545-0123": ["1120", "1120S", "1065", "1125E", "8825", "K1_1120S", "K1_1065"],
  "1545-0074": ["1040", "1040_SCH_1", "1040_SCH_C", "1040_SCH_E", "1040_SCH_F"],
};

/** Statement keywords — consulted ONLY when no IRS signal fired. */
const STATEMENT_PATTERNS: ReadonlyArray<[RegExp, FormFamily, string]> = [
  [/profit\s*(?:and|&)\s*loss|income statement|statement of operations/i, "PNL", "pnl-keyword"],
  [/balance sheet/i, "BALANCE_SHEET", "bs-keyword"],
  [/debt schedule|schedule of (?:liabilities|debts|loans)/i, "DEBT_SCHEDULE", "debt-keyword"],
];

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

  // 3. Statement keywords — only in the absence of any IRS signal.
  if (formFamily === null) {
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
