/**
 * Deterministic period binding (M5.3, Blueprint §4.3 step 3).
 *
 * Column headers parse into canonical periods (FY / interim months,
 * quarters, ranges / TTM / as-of dates — the columns V1 could not even
 * represent), and each value column binds to its period by COLUMN
 * IDENTITY, never by list position. Statement-level unit scaling
 * ("in thousands") is detected here and handed to the normalizer's
 * `scale` option downstream.
 */

import type { LayoutPage } from "../types.js";
import type { StatementGrid } from "./grid.js";

export interface CanonicalPeriod {
  kind: "fiscal_year" | "interim" | "ttm";
  /** ISO dates (inclusive). Point-in-time (as-of) periods have start = end. */
  startDate: string;
  endDate: string;
  label: string;
}

export type UnitScale = 1 | 1_000 | 1_000_000;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** Deterministic end-of-month (leap-year aware). */
const eom = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const month = (name: string): number | null => MONTHS[name.toLowerCase()] ?? null;

/** Parse ONE header cell's text into a canonical period, or null. */
export function parsePeriodHeader(raw: string): CanonicalPeriod | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text === "") return null;
  let m: RegExpExecArray | null;

  // TTM: "TTM Jun 2025", "Trailing Twelve Months ended June 30, 2025"
  m = /^(?:ttm|trailing twelve months)(?: ended?)? ([a-z]+)\.? ?(?:\d{1,2},? )?(\d{4})$/i.exec(
    text,
  );
  if (m?.[1] && m[2]) {
    const mm = month(m[1]);
    const y = Number(m[2]);
    if (mm !== null) {
      const startY = mm === 12 ? y : y - 1;
      const startM = mm === 12 ? 1 : mm + 1;
      return {
        kind: "ttm",
        startDate: iso(startY, startM, 1),
        endDate: iso(y, mm, eom(y, mm)),
        label: `TTM ${y}-${String(mm).padStart(2, "0")}`,
      };
    }
  }

  // Quarter: "Q1 2025", "1st Quarter 2025"
  m = /^(?:q([1-4])|([1-4])(?:st|nd|rd|th) quarter) (\d{4})$/i.exec(text);
  if (m?.[3]) {
    const q = Number(m[1] ?? m[2]);
    const y = Number(m[3]);
    const sm = (q - 1) * 3 + 1;
    const em = q * 3;
    return {
      kind: "interim",
      startDate: iso(y, sm, 1),
      endDate: iso(y, em, eom(y, em)),
      label: `Q${q} ${y}`,
    };
  }

  // Month range: "Jan - Jun 2025", "January 1 - June 30, 2025",
  // "January through June 30,2025" (CPA phrasing; comma spacing varies).
  m =
    /^([a-z]+)\.? ?(?:\d{1,2},? ?)?(?:[-–]|through|thru|to) ?([a-z]+)\.? ?(?:\d{1,2},? ?)?(\d{4})$/i.exec(
      text,
    );
  if (m?.[1] && m[2] && m[3]) {
    const m1 = month(m[1]);
    const m2 = month(m[2]);
    const y = Number(m[3]);
    if (m1 !== null && m2 !== null && m1 <= m2) {
      const fullYear = m1 === 1 && m2 === 12;
      return {
        kind: fullYear ? "fiscal_year" : "interim",
        startDate: iso(y, m1, 1),
        endDate: iso(y, m2, eom(y, m2)),
        label: fullYear
          ? `FY${y}`
          : `${y}-${String(m1).padStart(2, "0")}..${y}-${String(m2).padStart(2, "0")}`,
      };
    }
  }

  // Single month: "Jan 2025", "January 2025"
  m = /^([a-z]+)\.? (\d{4})$/i.exec(text);
  if (m?.[1] && m[2]) {
    const mm = month(m[1]);
    const y = Number(m[2]);
    if (mm !== null) {
      return {
        kind: "interim",
        startDate: iso(y, mm, 1),
        endDate: iso(y, mm, eom(y, mm)),
        label: `${y}-${String(mm).padStart(2, "0")}`,
      };
    }
  }

  // As-of date: "As of Dec 31, 2024", "December 31, 2024" (balance sheets)
  m = /^(?:as of )?([a-z]+)\.? (\d{1,2}),? (\d{4})$/i.exec(text);
  if (m?.[1] && m[2] && m[3]) {
    const mm = month(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (mm !== null && d >= 1 && d <= eom(y, mm)) {
      const point = iso(y, mm, d);
      return {
        kind: mm === 12 && d === 31 ? "fiscal_year" : "interim",
        startDate: point,
        endDate: point,
        label: `As of ${point}`,
      };
    }
  }

  // Numeric month-end column header: "10/31/24", "02/28/2025" (T12
  // spreads). Only exact month-ends are periods — any other date is a
  // transaction date, not a column identity.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (m?.[1] && m[2] && m[3]) {
    const mm = Number(m[1]);
    const d = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mm >= 1 && mm <= 12 && d === eom(y, mm)) {
      return {
        kind: "interim",
        startDate: iso(y, mm, 1),
        endDate: iso(y, mm, d),
        label: `${y}-${String(mm).padStart(2, "0")}`,
      };
    }
    return null;
  }

  // Fiscal year: "FY2024", "FY 2024", bare "2024"
  m = /^(?:fye? ?)?(\d{4})$/i.exec(text);
  if (m?.[1]) {
    const y = Number(m[1]);
    if (y >= 1990 && y <= 2100) {
      return {
        kind: "fiscal_year",
        startDate: iso(y, 1, 1),
        endDate: iso(y, 12, 31),
        label: `FY${y}`,
      };
    }
  }

  return null;
}

const THOUSANDS_RE = /\(?(?:amounts? )?in thousands\)?|\(\$?000'?s?\)/i;
const MILLIONS_RE = /\(?(?:amounts? )?in millions\)?|\(\$?000,000s?\)/i;

/** Statement-level unit scale from titles/notes (grid labels + page text). */
export function detectUnitScale(grid: StatementGrid, pages: LayoutPage[]): UnitScale {
  const texts: string[] = [
    ...grid.rows.map((r) => r.label),
    ...pages.filter((p) => p.page === grid.page).flatMap((p) => p.textBlocks.map((t) => t.text)),
  ];
  for (const t of texts) {
    if (MILLIONS_RE.test(t)) return 1_000_000;
    if (THOUSANDS_RE.test(t)) return 1_000;
  }
  return 1;
}

export interface PeriodBinding {
  /** Column id → canonical period (null = header not parseable → review). */
  byColumn: Map<number, CanonicalPeriod | null>;
  /** Grid row indexes consumed as header rows (excluded from mapping). */
  headerRowIndexes: number[];
  scale: UnitScale;
}

/** Period-shaped substrings inside merged title text (search, not match). */
const PERIOD_SUBSTRING_RES = [
  // "January through June 30,2025", "Jan 1 - Sep 30, 2025"
  /[a-z]+\.? ?(?:\d{1,2},? ?)?(?:[-\u2013]|through|thru|to) ?[a-z]+\.? ?(?:\d{1,2},? ?)?\d{4}/gi,
  // "As of June 30, 2025", "December 31, 2024"
  /(?:as of )?[a-z]+\.? \d{1,2},? \d{4}/gi,
  // "TTM Jun 2025", "Trailing Twelve Months ended June 30, 2025"
  /(?:ttm|trailing twelve months)(?: ended?)? [a-z]+\.? ?(?:\d{1,2},? )?\d{4}/gi,
];

export function findPeriodInText(text: string): CanonicalPeriod | null {
  for (const re of PERIOD_SUBSTRING_RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const parsed = parsePeriodHeader(m[0]);
      if (parsed) return parsed;
    }
  }
  return null;
}

/** Scan the top rows for period headers; bind by column identity. */
export function bindPeriods(grid: StatementGrid, pages: LayoutPage[] = []): PeriodBinding {
  const byColumn = new Map<number, CanonicalPeriod | null>();
  const headerRowIndexes: number[] = [];

  for (const row of grid.rows.slice(0, 5)) {
    let parsedAny = false;
    for (const [col, cell] of row.cells) {
      if (byColumn.get(col)) continue; // first parseable header wins
      const period = parsePeriodHeader(cell.text);
      if (period) {
        byColumn.set(col, period);
        parsedAny = true;
      }
    }
    if (parsedAny) headerRowIndexes.push(row.rowIndex);
    // Stop once every column is bound.
    if (grid.columnIds.every((c) => byColumn.get(c))) break;
  }

  // Page-title fallback (real CPA statements print the period in the
  // title block, not a table cell): allowed ONLY for single-value-column
  // grids — one column, one period, no guessing about order. Multi-column
  // grids with unbound columns stay null → review owns them (Iron Law #4:
  // binding is by identity, never by position).
  if (grid.columnIds.length === 1) {
    const col = grid.columnIds[0]!;
    if (!byColumn.get(col)) {
      for (const p of pages.filter((p) => p.page === grid.page || p.page === 1)) {
        for (const block of p.textBlocks) {
          // Vendors merge title lines into one block ("Acme LLC Profit &
          // Loss January through June 30,2025") — parse the whole text,
          // then fall back to period-shaped substrings within it.
          const period = parsePeriodHeader(block.text) ?? findPeriodInText(block.text);
          if (period) {
            byColumn.set(col, period);
            break;
          }
        }
        if (byColumn.get(col)) break;
      }
    }
  }

  for (const col of grid.columnIds) {
    if (!byColumn.has(col)) byColumn.set(col, null);
  }
  return { byColumn, headerRowIndexes, scale: detectUnitScale(grid, pages) };
}
