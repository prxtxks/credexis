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
