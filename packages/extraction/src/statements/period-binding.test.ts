import { describe, expect, it } from "vitest";
import { bindPeriods, detectUnitScale, parsePeriodHeader } from "./period-binding.js";
import type { StatementGrid } from "./grid.js";

describe("parsePeriodHeader (M5.3) — the column shapes V1 could not represent", () => {
  it.each<[string, object]>([
    [
      "FY2024",
      { kind: "fiscal_year", startDate: "2024-01-01", endDate: "2024-12-31", label: "FY2024" },
    ],
    ["2023", { kind: "fiscal_year", startDate: "2023-01-01", endDate: "2023-12-31" }],
    ["Jan - Dec 2024", { kind: "fiscal_year", label: "FY2024" }],
    [
      "January 1 - June 30, 2025",
      {
        kind: "interim",
        startDate: "2025-01-01",
        endDate: "2025-06-30",
        label: "2025-01..2025-06",
      },
    ],
    [
      "Jan 2025",
      { kind: "interim", startDate: "2025-01-01", endDate: "2025-01-31", label: "2025-01" },
    ],
    ["Feb 2024", { kind: "interim", endDate: "2024-02-29" }], // leap year
    [
      "Q1 2025",
      { kind: "interim", startDate: "2025-01-01", endDate: "2025-03-31", label: "Q1 2025" },
    ],
    ["3rd Quarter 2024", { kind: "interim", startDate: "2024-07-01", endDate: "2024-09-30" }],
    [
      "TTM Jun 2025",
      { kind: "ttm", startDate: "2024-07-01", endDate: "2025-06-30", label: "TTM 2025-06" },
    ],
    ["Trailing Twelve Months ended June 30, 2025", { kind: "ttm", startDate: "2024-07-01" }],
    ["As of Dec 31, 2024", { kind: "fiscal_year", startDate: "2024-12-31", endDate: "2024-12-31" }],
    ["June 30, 2025", { kind: "interim", startDate: "2025-06-30", endDate: "2025-06-30" }],
  ])("%s", (text, expected) => {
    expect(parsePeriodHeader(text)).toMatchObject(expected);
  });

  it.each(["Actual", "Budget", "% of Income", "", "Notes", "13 2024"])(
    "rejects non-period header %j",
    (text) => {
      expect(parsePeriodHeader(text)).toBeNull();
    },
  );
});

/* ── grid binding ───────────────────────────────────────────────────── */

const cellAt = (text: string, col: number, row: number) =>
  [col, { text, bbox: { x: 0.2 + col * 0.2, y: 0.05 + row * 0.03, w: 0.15, h: 0.02 } }] as const;

function gridWith(headerTexts: (string | null)[], labels: string[]): StatementGrid {
  const rows = [
    {
      rowIndex: 0,
      label: "",
      labelX: null,
      cells: new Map(headerTexts.flatMap((t, i) => (t === null ? [] : [cellAt(t, i + 1, 0)]))),
    },
    ...labels.map((label, i) => ({
      rowIndex: i + 1,
      label,
      labelX: 0.05,
      cells: new Map([cellAt("1,000", 1, i + 1), cellAt("2,000", 2, i + 1)]),
    })),
  ];
  return {
    page: 1,
    bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    columnIds: headerTexts.map((_, i) => i + 1),
    rows,
  };
}

describe("bindPeriods — geometric column binding", () => {
  it("binds each column id to its parsed period; unparseable → null (review)", () => {
    const binding = bindPeriods(gridWith(["FY2024", "FY2023", "% Change"], ["Revenue"]));
    expect(binding.byColumn.get(1)?.label).toBe("FY2024");
    expect(binding.byColumn.get(2)?.label).toBe("FY2023");
    expect(binding.byColumn.get(3)).toBeNull(); // '% Change' is not a period
    expect(binding.headerRowIndexes).toEqual([0]);
  });

  it("mixed period kinds side by side (annual + interim + TTM)", () => {
    const binding = bindPeriods(
      gridWith(["FY2024", "Jan - Jun 2025", "TTM Jun 2025"], ["Revenue"]),
    );
    expect(binding.byColumn.get(1)?.kind).toBe("fiscal_year");
    expect(binding.byColumn.get(2)?.kind).toBe("interim");
    expect(binding.byColumn.get(3)?.kind).toBe("ttm");
  });

  it("detects 'in thousands' from statement text and page blocks", () => {
    const grid = gridWith(["FY2024"], ["Revenue"]);
    grid.rows[1]!.label = "ACME LLC (in thousands)";
    expect(detectUnitScale(grid, [])).toBe(1000);

    const plain = gridWith(["FY2024"], ["Revenue"]);
    expect(
      detectUnitScale(plain, [
        {
          page: 1,
          textBlocks: [
            { text: "Amounts in thousands", bbox: { x: 0.1, y: 0.02, w: 0.3, h: 0.02 } },
          ],
          tables: [],
        },
      ]),
    ).toBe(1000);
    expect(detectUnitScale(plain, [])).toBe(1);
  });
});
