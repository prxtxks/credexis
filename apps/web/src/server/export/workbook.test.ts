import { describe, expect, it } from "vitest";
import { buildWorkbook, centsToExcelNumber, type ExportData } from "./workbook";

const DATA: ExportData = {
  dealName: "Acme Acquisition",
  entityName: "Acme Opco LLC",
  engineVersion: "engine-v0.1.0",
  policyPackVersion: "sop-50-10-8-2026-03",
  generatedAt: "2026-07-19T00:00:00.000Z",
  periods: ["FY2022", "FY2023"],
  incomeStatement: [
    {
      label: "Product sales",
      depth: 2,
      computed: false,
      cells: { FY2023: { kind: "cents", value: "50000000" } },
    },
    {
      label: "EBITDA",
      depth: 0,
      computed: true,
      cells: { FY2023: { kind: "cents", value: "18000000" } },
    },
  ],
  balanceSheet: [],
  globalCashFlow: [],
  addbacks: [
    {
      category: "officer_comp",
      state: "accepted",
      amountCents: "8000000",
      note: "one working owner",
      periodLabel: "FY2023",
    },
    {
      category: "one_time",
      state: "rejected",
      amountCents: "1500000",
      note: null,
      periodLabel: "FY2023",
    },
  ],
  scenario: {
    name: "Base case",
    amountCents: "35000000",
    termMonths: 120,
    rateDescription: "fixed 10.25%",
    annualDebtServiceCents: "5608644",
    cfadsCents: "18000000",
    dscrDisplay: "3.21",
  },
};

describe("centsToExcelNumber", () => {
  it("converts by string slicing — no arithmetic on money", () => {
    expect(centsToExcelNumber("123456")).toBe(1234.56);
    expect(centsToExcelNumber("-50")).toBe(-0.5);
    expect(centsToExcelNumber("7")).toBe(0.07);
    expect(centsToExcelNumber("0")).toBe(0);
  });
});

describe("buildWorkbook (M10.1)", () => {
  const wb = buildWorkbook(DATA);

  it("has the five banker tabs in order", () => {
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "Spread",
      "Balance Sheet",
      "Global CF",
      "Addbacks",
      "Pro-Forma",
      "Assumptions",
    ]);
  });

  it("writes spread values under the right period with money formatting", () => {
    const spread = wb.getWorksheet("Spread")!;
    expect(spread.getRow(1).getCell(2).value).toBe("FY2022");
    expect(spread.getRow(1).getCell(3).value).toBe("FY2023");
    // Product sales lands in the FY2023 column only.
    expect(spread.getRow(2).getCell(2).value).toBeNull();
    expect(spread.getRow(2).getCell(3).value).toBe(500000);
    expect(spread.getRow(2).getCell(3).numFmt).toContain("#,##0.00");
  });

  it("keeps live formulas where feasible: addbacks SUMIF + DSCR division", () => {
    const addbacks = wb.getWorksheet("Addbacks")!;
    const totalCell = addbacks.getRow(addbacks.rowCount).getCell(4);
    expect(totalCell.value).toMatchObject({ formula: expect.stringContaining("SUMIF") });

    const proforma = wb.getWorksheet("Pro-Forma")!;
    const dscrRow = [...Array(proforma.rowCount).keys()]
      .map((i) => proforma.getRow(i + 1))
      .find((r) => r.getCell(1).value === "DSCR (business)")!;
    expect(dscrRow.getCell(2).value).toMatchObject({
      formula: expect.stringContaining("B6/B7"),
    });
  });

  it("records provenance on Assumptions (engine + pinned pack versions)", () => {
    const a = wb.getWorksheet("Assumptions")!;
    const values = [...Array(a.rowCount).keys()].map((i) => [
      a.getRow(i + 1).getCell(1).value,
      a.getRow(i + 1).getCell(2).value,
    ]);
    expect(values).toContainEqual(["Engine version", "engine-v0.1.0"]);
    expect(values).toContainEqual(["Policy pack", "sop-50-10-8-2026-03"]);
  });
});
