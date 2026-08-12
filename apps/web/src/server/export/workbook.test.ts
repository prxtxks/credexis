import { describe, expect, it } from "vitest";
import { buildWorkbook, centsToExcelNumber, hexToArgb, type ExportData } from "./workbook";

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
  it("converts by string slicing - no arithmetic on money", () => {
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

describe("pro-forma forecast sheet (M16 - the bank template's shape)", () => {
  const WITH_PF: ExportData = {
    ...DATA,
    proforma: {
      entityName: "Acme Opco LLC",
      basePeriodLabel: "FY2023",
      monthsCovered: 12,
      loanScenarioName: "SBA 7(a) - $1.2M",
      growthBpsByYear: [0, 300, 300],
      replacementSalaryCents: "6000000",
      treatments: { "is.opex.rent": "fixed" },
      baseAnnualized: {
        revenueCents: "46469028",
        lines: [{ label: "Rent", amountCents: "1200000" }],
      },
      years: [
        {
          label: "Year 1",
          revenueCents: "46469028",
          lines: [{ label: "Rent", amountCents: "1200000" }],
          operatingExpensesCents: "1200000",
          noiCents: "45269028",
          cfadsCents: "39269028",
          debtServiceCents: "1329600",
        },
      ],
    },
  };

  it("renders the paired amount + % columns with LIVE percentage formulas", () => {
    const wb = buildWorkbook(WITH_PF);
    const sheet = wb.getWorksheet("Pro-Forma")!;
    // Header: Line | FY2023 (annualized) | % | Year 1 | %
    const header = sheet.getRow(2).values as unknown[];
    expect(header).toContain("FY2023 (annualized)");
    expect(header).toContain("Year 1");
    // Revenue row carries money numbers; the line row's % cell is a formula
    // dividing its amount by the revenue cell in the SAME column - the
    // template's checkable %-of-sales pairing, never a baked number.
    const rentRow = sheet.getRow(4);
    expect(rentRow.getCell(2).value).toBeCloseTo(12000, 5);
    const pct = rentRow.getCell(3).value as { formula?: string };
    expect(pct.formula).toMatch(/B4\s*\/\s*B\$3/);
  });

  it("DSCR row divides CFADS by debt service as a live formula per year", () => {
    const wb = buildWorkbook(WITH_PF);
    const sheet = wb.getWorksheet("Pro-Forma")!;
    let dscrRow = 0;
    sheet.eachRow((row, n) => {
      if (row.getCell(1).value === "DSCR") dscrRow = n;
    });
    expect(dscrRow).toBeGreaterThan(0);
    const cell = sheet.getRow(dscrRow).getCell(4);
    expect((cell.value as { formula?: string }).formula).toMatch(/D\d+\s*\/\s*D\d+/);
  });

  it("assumptions sheet records the pro-forma inputs (the audit trail)", () => {
    const wb = buildWorkbook(WITH_PF);
    const sheet = wb.getWorksheet("Assumptions")!;
    const texts: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((c) => texts.push(String(c.value ?? "")));
    });
    expect(texts.join("|")).toContain("Base period");
    expect(texts.join("|")).toContain("FY2023");
    expect(texts.join("|")).toContain("Y2 growth");
    expect(texts.join("|")).toContain("3%");
    expect(texts.join("|")).toContain("is.opex.rent");
  });

  it("a deal without a projectable base keeps the legacy scenario summary", () => {
    const wb = buildWorkbook(DATA);
    const sheet = wb.getWorksheet("Pro-Forma")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Metric");
  });
});

describe("export branding (M17 - the bank's identity on the file)", () => {
  const BRANDED: ExportData = {
    ...DATA,
    branding: {
      displayName: "First National Bank",
      primaryColor: "#1A3C6E",
      accentColor: "#0F2547",
      footerText: "Confidential - internal credit review",
    },
  };

  it("title block leads each spread sheet and the header wears the primary color", () => {
    const wb = buildWorkbook(BRANDED);
    const sheet = wb.getWorksheet("Spread")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("First National Bank - Spread");
    const fill = sheet.getRow(2).getCell(1).fill as { fgColor?: { argb?: string } };
    expect(fill.fgColor?.argb).toBe("FF1A3C6E");
  });

  it("footer text travels on the Assumptions sheet", () => {
    const wb = buildWorkbook(BRANDED);
    const texts: string[] = [];
    wb.getWorksheet("Assumptions")!.eachRow((r) => r.eachCell((c) => texts.push(String(c.value))));
    expect(texts.join("|")).toContain("Confidential - internal credit review");
  });

  it("unbranded exports keep the original anatomy (header at row 1)", () => {
    const wb = buildWorkbook(DATA);
    expect(wb.getWorksheet("Spread")!.getRow(1).getCell(1).value).toBe("Line item");
  });

  it("hexToArgb tolerates garbage with the fallback", () => {
    expect(hexToArgb("#1A3C6E", "#000000")).toBe("FF1A3C6E");
    expect(hexToArgb("teal", "#0D7A5F")).toBe("FF0D7A5F");
  });
});
