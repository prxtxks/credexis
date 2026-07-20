import { describe, expect, it } from "vitest";
import {
  bindPeriods,
  detectUnitScale,
  findPeriodInText,
  parsePeriodHeader,
} from "./period-binding.js";
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

describe("real-world title hazards (annual P&L + Maitripriya findings)", () => {
  it("parses a range whose separator was lost to a line break", () => {
    expect(parsePeriodHeader("January December 2024")).toMatchObject({ label: "FY2024" });
    expect(findPeriodInText("Profit and Loss\nJanuary December 2024")).toMatchObject({
      label: "FY2024",
    });
  });

  it("NEVER binds a print-date footer as the period", () => {
    expect(
      findPeriodInText("Accrual Basis Thursday, February 6, 2025 02:13 PM GMT-05:00"),
    ).toBeNull();
  });

  it("parses same-month day ranges (Travelodge scorecard skip, 2026-07-20)", () => {
    // QuickBooks custom-range reports print "April 1-30, 2025" — a day
    // range within one month. Full-corpus scorecard skipped the doc: no
    // pattern covered it, so the single-column grid never got a period.
    expect(parsePeriodHeader("April 1-30, 2025")).toMatchObject({ label: "2025-04" });
    // Partial month stays honest — exact dates, never rounded to a month.
    expect(parsePeriodHeader("April 1-15, 2025")).toMatchObject({
      label: "2025-04-01..2025-04-15",
    });
    // The real Travelodge title block, verbatim from Reducto.
    expect(findPeriodInText("Niyazi Hotels & Resorts Inc.\nApril 1-30, 2025")).toMatchObject({
      label: "2025-04",
    });
  });

  it('finds a bare single-month title ("April 2025")', () => {
    expect(findPeriodInText("Travelodge by Wyndham\nProfit and Loss\nApril 2025")).toMatchObject({
      label: "2025-04",
    });
    // A range in the same text still wins over its embedded month-year.
    expect(findPeriodInText("Profit and Loss\nJanuary December 2024")).toMatchObject({
      label: "FY2024",
    });
  });

  it("binds the numeric column when the other column is label-only", () => {
    const cells = (col: number, text: string) => [col, { text, bbox: null }] as const;
    const grid: StatementGrid = {
      page: 2,
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      columnIds: [1, 2],
      rows: [
        { rowIndex: 0, label: "Current Assets", labelX: 0, cells: new Map([cells(1, "Equity")]) },
        { rowIndex: 1, label: "Petty Cash", labelX: 0, cells: new Map([cells(2, "$ 500.00")]) },
        { rowIndex: 2, label: "Checking", labelX: 0, cells: new Map([cells(2, "97,185.57")]) },
      ],
    };
    const pages = [
      {
        page: 2,
        textBlocks: [
          { text: "Balance Sheet As of May 31, 2025", bbox: { x: 0.3, y: 0.03, w: 0.4, h: 0.02 } },
        ],
        tables: [],
      },
    ];
    const binding = bindPeriods(grid, pages as never);
    expect(binding.byColumn.get(2)).toMatchObject({ label: "As of 2025-05-31" });
    expect(binding.byColumn.get(1)).toBeNull(); // label column stays unbound
  });
});

describe("merged title blocks (vendors concatenate title lines)", () => {
  it("finds the period inside a merged company+title+period block", () => {
    expect(
      findPeriodInText(
        "Greenbay Petroleum And Investment LLC Profit & Loss January through June 30,2025",
      ),
    ).toMatchObject({ label: "2025-01..2025-06" });
    expect(
      findPeriodInText("Maitripriya LLC Balance Sheet As of May 31, 2025 Accrual Basis"),
    ).toMatchObject({ label: "As of 2025-05-31" });
    expect(findPeriodInText("no dates here at all")).toBeNull();
  });
});

describe("real CPA statement headers (bake-off findings, 2026-07-20)", () => {
  it("parses 'through' ranges, with sloppy comma spacing", () => {
    expect(parsePeriodHeader("January through June 30,2025")).toMatchObject({
      kind: "interim",
      startDate: "2025-01-01",
      endDate: "2025-06-30",
      label: "2025-01..2025-06",
    });
    expect(parsePeriodHeader("January through December 2024")).toMatchObject({
      kind: "fiscal_year",
      label: "FY2024",
    });
  });

  it("parses numeric month-end column headers (T12 spreads)", () => {
    expect(parsePeriodHeader("10/31/24")).toMatchObject({
      kind: "interim",
      startDate: "2024-10-01",
      endDate: "2024-10-31",
      label: "2024-10",
    });
    expect(parsePeriodHeader("02/28/25")).toMatchObject({ label: "2025-02" });
    // A non-month-end numeric date is a transaction date, not a period.
    expect(parsePeriodHeader("10/15/24")).toBeNull();
  });

  it("binds a single value column from the PAGE TITLE when cells carry no header", () => {
    const grid: StatementGrid = {
      page: 2,
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      columnIds: [1],
      rows: [
        { rowIndex: 0, label: "Current Assets", labelX: 0, cells: new Map() },
        {
          rowIndex: 1,
          label: "Petty Cash",
          labelX: 0,
          cells: new Map([[1, { text: "$ 500.00", bbox: null }]]),
        },
      ],
    };
    const pages = [
      {
        page: 2,
        textBlocks: [
          { text: "Maitripriya LLC", bbox: { x: 0.3, y: 0.02, w: 0.4, h: 0.02 } },
          { text: "Balance Sheet", bbox: { x: 0.35, y: 0.05, w: 0.3, h: 0.02 } },
          { text: "As of May 31, 2025", bbox: { x: 0.33, y: 0.08, w: 0.34, h: 0.02 } },
        ],
        tables: [],
      },
    ];
    const binding = bindPeriods(grid, pages as never);
    expect(binding.byColumn.get(1)).toMatchObject({ label: "As of 2025-05-31" });
  });

  it("never guesses for MULTI-column grids from page text (review owns it)", () => {
    const grid: StatementGrid = {
      page: 1,
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      columnIds: [1, 2],
      rows: [
        {
          rowIndex: 0,
          label: "Sales",
          labelX: 0,
          cells: new Map([
            [1, { text: "100", bbox: null }],
            [2, { text: "200", bbox: null }],
          ]),
        },
      ],
    };
    const pages = [
      {
        page: 1,
        textBlocks: [{ text: "January through June 30,2025", bbox: { x: 0, y: 0, w: 1, h: 0.02 } }],
        tables: [],
      },
    ];
    const binding = bindPeriods(grid, pages as never);
    expect(binding.byColumn.get(1)).toBeNull();
    expect(binding.byColumn.get(2)).toBeNull();
  });
});
