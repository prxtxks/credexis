import { describe, expect, it } from "vitest";
import { pagesToGrids, toStatementGrid } from "./grid.js";
import type { LayoutTable } from "../types.js";

const box = (x: number, y: number) => ({ x, y, w: 0.15, h: 0.02 });

function cell(row: number, col: number, text: string) {
  return { rowIndex: row, colIndex: col, text, bbox: box(0.05 + col * 0.2, 0.1 + row * 0.03) };
}

describe("layout → statement grid (M5.1)", () => {
  it("REGRESSION (post-mortem trap 1): a blank middle cell does NOT shift columns", () => {
    // Three periods; row 'Rent' is missing the FY2023 (col 2) value.
    // V1 assigned values by list position — 36,500 would land in FY2023.
    const table: LayoutTable = {
      page: 1,
      bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.5 },
      cells: [
        cell(0, 0, "Revenue"),
        cell(0, 1, "1,000,000"),
        cell(0, 2, "950,000"),
        cell(0, 3, "900,000"),
        cell(1, 0, "Rent"),
        cell(1, 1, "36,000"),
        // ← col 2 blank on the document: the vendor emits no cell
        cell(1, 3, "36,500"),
      ],
    };
    const grid = toStatementGrid(table);
    const rent = grid.rows[1]!;
    expect(rent.cells.get(1)?.text).toBe("36,000");
    expect(rent.cells.get(2)).toBeUndefined(); // blank stays blank
    expect(rent.cells.get(3)?.text).toBe("36,500"); // and col 3 stays col 3
  });

  it("keeps vendor row order and label indentation for row typing", () => {
    const table: LayoutTable = {
      page: 1,
      bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.5 },
      cells: [
        { rowIndex: 0, colIndex: 0, text: "Operating Expenses", bbox: box(0.05, 0.1) },
        { rowIndex: 1, colIndex: 0, text: "Rent", bbox: box(0.09, 0.13) }, // indented
        cell(1, 1, "36,000"),
        { rowIndex: 2, colIndex: 0, text: "Total Operating Expenses", bbox: box(0.05, 0.16) },
        cell(2, 1, "36,000"),
      ],
    };
    const grid = toStatementGrid(table);
    expect(grid.rows.map((r) => r.label)).toEqual([
      "Operating Expenses",
      "Rent",
      "Total Operating Expenses",
    ]);
    expect(grid.rows[1]!.labelX!).toBeGreaterThan(grid.rows[0]!.labelX!);
  });

  it("concatenates split label cells in x-order; sorts columns and pages", () => {
    const table: LayoutTable = {
      page: 2,
      bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.5 },
      cells: [
        { rowIndex: 0, colIndex: 0, text: "Officer", bbox: box(0.05, 0.1) },
        { rowIndex: 0, colIndex: 0, text: "Compensation", bbox: box(0.11, 0.1) },
        cell(0, 3, "185,000"),
        cell(0, 1, "190,000"),
      ],
    };
    const grid = toStatementGrid(table);
    expect(grid.rows[0]?.label).toBe("Officer Compensation");
    expect(grid.columnIds).toEqual([1, 3]);

    const grids = pagesToGrids([
      { page: 2, textBlocks: [], tables: [table] },
      { page: 1, textBlocks: [], tables: [{ ...table, page: 1 }] },
    ]);
    expect(grids.map((g) => g.page)).toEqual([1, 2]);
  });
});

describe("wrapped label tail in the indent column (M24 - the bs-monthly finding)", () => {
  // Real partnership balance sheet: two label columns (col 0 label, col 1
  // indent) + one value column. The last row's label wrapped and the
  // vendor put the tail word "Equity" in col 1 - so the label read
  // "Total Liabilities and Partners'" and never matched. A non-numeric
  // cell in a column that carries NO numeric cells anywhere in the table
  // is label text, by construction - merge it into the label.
  it("merges text from a numberless column into the row label", () => {
    const table: LayoutTable = {
      page: 2,
      bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.5 },
      cells: [
        cell(0, 0, "Total Partners' Equity"),
        cell(0, 2, "220,468.34"),
        cell(1, 0, "Total Liabilities and Partners'"),
        cell(1, 1, "Equity"),
        cell(1, 2, "$ 1,451,496.68"),
      ],
    };
    const grid = toStatementGrid(table);
    expect(grid.rows[1]!.label).toBe("Total Liabilities and Partners' Equity");
    expect(grid.rows[1]!.cells.has(1)).toBe(false); // absorbed
    expect(grid.rows[1]!.cells.get(2)?.text).toBe("$ 1,451,496.68");
    expect(grid.columnIds).toEqual([2]); // the indent column is not a value column
  });

  it("does NOT absorb text from a column that carries numbers elsewhere", () => {
    // "n/a" in a real value column is a value cell (dash/blank semantics), not label.
    const table: LayoutTable = {
      page: 1,
      bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.5 },
      cells: [cell(0, 0, "Revenue"), cell(0, 1, "1,000"), cell(1, 0, "Rent"), cell(1, 1, "n/a")],
    };
    const grid = toStatementGrid(table);
    expect(grid.rows[1]!.label).toBe("Rent");
    expect(grid.rows[1]!.cells.get(1)?.text).toBe("n/a");
  });
});
