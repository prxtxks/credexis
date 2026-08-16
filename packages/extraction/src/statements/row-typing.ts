/**
 * Deterministic row typing (M5.2, Blueprint §4.3 step 2).
 *
 * Types every grid row as header / item / subtotal / total / section_break
 * using indentation, keywords, and ARITHMETIC: "a row whose value equals
 * the sum of the block above it is a subtotal — verified numerically, not
 * guessed." Keyword-only claims are typed but carry
 * `numericallyVerified: false` — structure validation (M5.5) turns
 * unverified/failed claims into issues; nothing here guesses silently.
 */

import { normalizeAmount, type Cents } from "@credexis/shared";
import type { GridRow, StatementGrid } from "./grid.js";

export type RowType =
  | "header"
  | "item"
  | "subtotal"
  | "total"
  | "section_break"
  /** Below the income statement's bottom line: add-back / EBITDA / memo
   *  blocks an accountant appended. Analysis, never source facts (M23). */
  | "supplemental";

export interface TypedRow {
  row: GridRow;
  type: RowType;
  /** Normalized cents per column id; null = blank/dash. */
  valuesCents: Map<number, Cents | null>;
  /** True when any cell's text failed normalization (routes to review). */
  hasUnreadable: boolean;
  /** For subtotal/total rows: did the arithmetic actually check out? */
  numericallyVerified: boolean;
}

const TOTAL_KEYWORD = /^(total|net (income|profit|loss)|gross profit)\b/i;
const GRAND_KEYWORD =
  /^(net (income|profit|loss)|total (assets|liabilities and (?:stockholders'?|owner'?s?|members'?)? ?equity|equity and liabilities))\b/i;

const TOLERANCE_CENTS = 100n; // ±$1/level (Blueprint §4.5 G1)

/** THE bottom line - not "Net Income Before Taxes", not "Net Operating
 *  Income": those are intermediate and rows after them are still facts.
 *  Optional "(Loss)" / "/ (Loss)" decoration; nothing else may follow. */
const BOTTOM_LINE_RE = /^net (?:income|profit|loss)(?: ?\/? ?\((?:loss|deficit)\))?\s*$/i;

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

/** values match accumulator in every column where the row has a value. */
function matchesBlock(
  values: Map<number, Cents | null>,
  block: Map<number, bigint>,
  columnIds: number[],
): boolean {
  let compared = 0;
  for (const col of columnIds) {
    const v = values.get(col);
    if (v === null || v === undefined) continue;
    const sum = block.get(col) ?? 0n;
    if (absDiff(v, sum) > TOLERANCE_CENTS) return false;
    compared++;
  }
  return compared > 0;
}

export interface TypeRowsOptions {
  /** Income statements end at Net Income; rows below are supplemental
   *  (add-back / EBITDA blocks). NEVER for balance sheets, where "Net
   *  Income" is an equity line item followed by real totals (M23). */
  bottomLineIs?: "net_income" | undefined;
}

export function typeRows(grid: StatementGrid, opts: TypeRowsOptions = {}): TypedRow[] {
  const out: TypedRow[] = [];
  // Running sums per column: items since last subtotal boundary, and
  // subtotals since last total boundary.
  const itemBlock = new Map<number, bigint>();
  const subtotalBlock = new Map<number, bigint>();
  let itemsInBlock = 0;
  let subtotalsInBlock = 0;

  const addTo = (block: Map<number, bigint>, values: Map<number, Cents | null>) => {
    for (const [col, v] of values) {
      if (v !== null) block.set(col, (block.get(col) ?? 0n) + v);
    }
  };

  let belowBottomLine = false;

  for (const row of grid.rows) {
    // Everything after the bottom line is supplemental (M23): the
    // RAJ KRUPA add-back block re-printed depreciation / amortization /
    // interest below Net Income and the mapper summed them twice.
    if (belowBottomLine) {
      const valuesCents = new Map<number, Cents | null>();
      for (const [col, cell] of row.cells) {
        const r = normalizeAmount(cell.text);
        valuesCents.set(col, r.ok ? r.cents : null);
      }
      out.push({
        row,
        type: "supplemental",
        valuesCents,
        hasUnreadable: false,
        numericallyVerified: false,
      });
      continue;
    }

    // Normalize the row's cells (raw scale — unit scaling is M5.3's).
    const valuesCents = new Map<number, Cents | null>();
    let hasUnreadable = false;
    let hasValue = false;
    for (const [col, cell] of row.cells) {
      const r = normalizeAmount(cell.text);
      if (r.ok) {
        valuesCents.set(col, r.cents);
        if (r.cents !== null) hasValue = true;
      } else {
        valuesCents.set(col, null);
        hasUnreadable = true;
      }
    }

    let type: RowType;
    let numericallyVerified = false;
    const hasCells = row.cells.size > 0;

    if (!hasCells && row.label === "") {
      type = "section_break";
    } else if (!hasCells) {
      type = "header";
      // A header opens a new item block (its section starts fresh).
      itemBlock.clear();
      itemsInBlock = 0;
    } else if (!hasValue) {
      // Cells exist but are all dashes/blank — an item with no amounts
      // (e.g. "Depreciation  —"), not a header.
      type = "item";
    } else if (itemsInBlock > 0 && matchesBlock(valuesCents, itemBlock, grid.columnIds)) {
      // Arithmetic first: it IS the sum of the items above it.
      type = "subtotal";
      numericallyVerified = true;
      addTo(subtotalBlock, valuesCents);
      subtotalsInBlock++;
      itemBlock.clear();
      itemsInBlock = 0;
    } else if (
      subtotalsInBlock > 0 &&
      itemsInBlock === 0 &&
      matchesBlock(valuesCents, subtotalBlock, grid.columnIds)
    ) {
      // Sums the subtotals since the last total → a total row.
      type = "total";
      numericallyVerified = true;
      subtotalBlock.clear();
      subtotalsInBlock = 0;
    } else if (GRAND_KEYWORD.test(row.label)) {
      // Keyword-claimed grand total that did NOT verify numerically here
      // (e.g. Net Income = revenue − expenses is a difference, not a block
      // sum) — typed by claim, flagged unverified for M5.5's tree math.
      type = "total";
      subtotalBlock.clear();
      subtotalsInBlock = 0;
    } else if (TOTAL_KEYWORD.test(row.label)) {
      type = "subtotal";
      addTo(subtotalBlock, valuesCents);
      subtotalsInBlock++;
      itemBlock.clear();
      itemsInBlock = 0;
    } else {
      type = "item";
      addTo(itemBlock, valuesCents);
      itemsInBlock++;
    }

    out.push({ row, type, valuesCents, hasUnreadable, numericallyVerified });
    if (opts.bottomLineIs === "net_income" && hasValue && BOTTOM_LINE_RE.test(row.label.trim())) {
      belowBottomLine = true;
    }
  }
  return out;
}
