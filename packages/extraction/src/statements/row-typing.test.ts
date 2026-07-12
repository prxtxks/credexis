/**
 * M5.2 fixtures across the styles the corpus will contain: QuickBooks
 * (keyworded totals), CPA (unlabeled numeric subtotals), hand-built
 * (wrong subtotal — typed by claim, flagged unverified).
 */

import { describe, expect, it } from "vitest";
import { typeRows } from "./row-typing.js";
import type { StatementGrid } from "./grid.js";

/** Compact grid builder: [label, ...values] with "" for blank cells. */
function grid(rows: Array<[string, ...(string | null)[]]>): StatementGrid {
  return {
    page: 1,
    bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    columnIds: [1, 2],
    rows: rows.map(([label, ...values], i) => ({
      rowIndex: i,
      label,
      labelX: 0.05,
      cells: new Map(
        values
          .map((v, ci) => [ci + 1, v] as const)
          .filter((entry): entry is [number, string] => entry[1] !== null)
          .map(([col, text]) => [
            col,
            { text, bbox: { x: 0.2 + col * 0.2, y: 0.05 + i * 0.03, w: 0.15, h: 0.02 } },
          ]),
      ),
    })),
  };
}

describe("row typing (M5.2) — QuickBooks style", () => {
  const typed = typeRows(
    grid([
      ["Income"],
      ["Sales", "500,000", "450,000"],
      ["Services", "100,000", "90,000"],
      ["Total Income", "600,000", "540,000"],
      ["Expenses"],
      ["Rent", "36,000", "34,000"],
      ["Payroll", "300,000", "280,000"],
      ["Total Expenses", "336,000", "314,000"],
      ["Net Income", "264,000", "226,000"],
    ]),
  );

  it("types headers, items, numerically-verified subtotals", () => {
    expect(typed.map((t) => t.type)).toEqual([
      "header",
      "item",
      "item",
      "subtotal",
      "header",
      "item",
      "item",
      "subtotal",
      "total",
    ]);
    expect(typed[3]).toMatchObject({ numericallyVerified: true });
    expect(typed[7]).toMatchObject({ numericallyVerified: true });
  });

  it("Net Income (a difference, not a block sum) is total-by-keyword, unverified here", () => {
    expect(typed[8]).toMatchObject({ type: "total", numericallyVerified: false });
    // M5.5's tree re-aggregation is where 600,000 − 336,000 = 264,000 checks out.
  });

  it("normalizes values across both period columns", () => {
    expect(typed[1]?.valuesCents.get(1)).toBe(50000000n);
    expect(typed[1]?.valuesCents.get(2)).toBe(45000000n);
  });
});

describe("row typing — CPA style (no keywords: arithmetic decides)", () => {
  it("an UNLABELED row equal to the block above is a subtotal", () => {
    const typed = typeRows(
      grid([
        ["Revenues"],
        ["Product revenue", "800,000"],
        ["Service revenue", "150,000"],
        ["", "950,000"], // CPA-style underlined sum, no label
      ]),
    );
    expect(typed[3]).toMatchObject({ type: "subtotal", numericallyVerified: true });
  });

  it("±$1 rounding tolerance per level", () => {
    const typed = typeRows(
      grid([
        ["A", "100.40"],
        ["B", "200.35"],
        ["Sum", "300.74"], // off by 1¢ from 300.75 — still a subtotal
      ]),
    );
    expect(typed[2]).toMatchObject({ type: "subtotal", numericallyVerified: true });
  });
});

describe("row typing — hand-built style traps", () => {
  it("a WRONG 'Total' is typed by claim but flagged unverified (M5.5 raises the issue)", () => {
    const typed = typeRows(
      grid([
        ["Fuel", "1,000"],
        ["Tolls", "2,000"],
        ["Total Vehicle", "3,500"], // wrong: should be 3,000
      ]),
    );
    expect(typed[2]).toMatchObject({ type: "subtotal", numericallyVerified: false });
  });

  it("dash-only rows are items with null values, not headers", () => {
    const typed = typeRows(grid([["Depreciation", "—", "—"]]));
    expect(typed[0]?.type).toBe("item");
    expect(typed[0]?.valuesCents.get(1)).toBeNull();
  });

  it("unreadable cells flag the row for review", () => {
    const typed = typeRows(grid([["Weird", "1.020"]])); // ambiguous separator
    expect(typed[0]?.hasUnreadable).toBe(true);
  });

  it("balance sheet: grand total by keyword after mixed sections", () => {
    const typed = typeRows(
      grid([
        ["Assets"],
        ["Cash", "50,000"],
        ["Receivables", "30,000"],
        ["Total Assets", "80,000"],
        ["Liabilities"],
        ["Accounts payable", "20,000"],
        ["Total Liabilities", "20,000"],
        ["Equity"],
        ["Retained earnings", "60,000"],
        ["Total Equity", "60,000"],
        ["Total Liabilities and Equity", "80,000"],
      ]),
    );
    expect(typed.map((t) => t.type)).toEqual([
      "header",
      "item",
      "item",
      "subtotal",
      "header",
      "item",
      "subtotal",
      "header",
      "item",
      "subtotal",
      "total",
    ]);
    // 20,000 + 60,000 ≠ 80,000 block-wise? No: subtotal block holds
    // 80,000 (assets) + 20,000 + 60,000 = 160,000 → keyword path, and
    // A = L + E itself is G2's check (M5.5), not row typing's.
    expect(typed[10]?.numericallyVerified).toBe(false);
  });
});
