/**
 * Deterministic page signals (M3.5, Blueprint §4.1): IRS form numbers and
 * OMB control numbers are printed with high regularity — they are checked
 * FIRST, before any LLM sees a page (deterministic beats probabilistic,
 * Iron Law #1 spirit).
 *
 * Ordering matters and is load-bearing:
 * - K-1 pages contain the parent form's number ("Schedule K-1 (Form 1120-S)")
 *   → K-1 patterns run before plain form patterns.
 * - An 1120-S continuation page titled "Schedule L — Balance Sheets per
 *   Books" must NOT classify as a BALANCE_SHEET statement → statement
 *   keywords run only when no IRS signal fired.
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

/** Ordered — first hit wins. Most-specific patterns first. */
const IRS_FORM_PATTERNS: ReadonlyArray<[RegExp, FormFamily, string]> = [
  [/schedule\s+k-?1\s*\(form\s+1120-?s\)/i, "K1_1120S", "k1-1120s"],
  [/schedule\s+k-?1\s*\(form\s+1065\)/i, "K1_1065", "k1-1065"],
  [/schedule\s+c\s*\(form\s+1040\)|profit or loss from business/i, "1040_SCH_C", "sch-c"],
  [/schedule\s+e\s*\(form\s+1040\)|supplemental income and loss/i, "1040_SCH_E", "sch-e"],
  [/schedule\s+f\s*\(form\s+1040\)|profit or loss from farming/i, "1040_SCH_F", "sch-f"],
  [/schedule\s+1\s*\(form\s+1040\)/i, "1040_SCH_1", "sch-1"],
  [/form\s+1125-?e|compensation of officers/i, "1125E", "1125e"],
  [/form\s+8825|rental real estate income and expenses of a partnership/i, "8825", "8825"],
  [/form\s+4562|depreciation and amortization/i, "4562", "4562"],
  [/form\s+1120-?s\b/i, "1120S", "1120s"],
  [/form\s+1120\b/i, "1120", "1120"],
  [/form\s+1065\b/i, "1065", "1065"],
  [/form\s+w-?2\b|wage and tax statement/i, "W2", "w2"],
  [/form\s+1040\b/i, "1040", "1040"],
];

/** OMB control numbers — unique ones classify alone; shared ones corroborate. */
const OMB_RE = /omb\s+no\.?\s*(1545-\d{4})/i;
const OMB_UNIQUE: Readonly<Record<string, FormFamily>> = {
  "1545-0008": "W2",
};
/** 1545-0123 spans 1120/1120-S/1065; 1545-0074 spans the 1040 family. */
const OMB_CORROBORATING = new Set(["1545-0123", "1545-0074"]);

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

  // 1. IRS form patterns (ordered, first hit wins).
  for (const [re, family, label] of IRS_FORM_PATTERNS) {
    if (re.test(text)) {
      formFamily = family;
      confidence = 0.9;
      matched.push(`form:${label}`);
      break;
    }
  }

  // 2. OMB number — unique ones classify, shared ones corroborate.
  const omb = OMB_RE.exec(text)?.[1];
  if (omb) {
    matched.push(`omb:${omb}`);
    const unique = OMB_UNIQUE[omb];
    if (formFamily !== null && (OMB_CORROBORATING.has(omb) || unique === formFamily)) {
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
