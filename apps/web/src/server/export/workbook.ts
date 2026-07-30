/**
 * Banker workbook export (M10.1, Blueprint §8.2): Spread · Addbacks ·
 * Global CF · Pro-Forma · Assumptions tabs via exceljs - a real workbook,
 * not V1's mislabeled CSV.
 *
 * Money boundary: Excel cells are IEEE doubles, so this is the ONE place
 * integer cents become decimal numbers - via string slicing (never
 * division), formatted "#,##0.00". The Assumptions tab states that
 * Credexis holds the authoritative integer-cent values.
 */

import { Workbook, type Worksheet } from "exceljs";

/** "123456" → 1234.56 without arithmetic on the money value. */
export function centsToExcelNumber(cents: string): number {
  const neg = cents.startsWith("-");
  const digits = (neg ? cents.slice(1) : cents).padStart(3, "0");
  const text = `${neg ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
  return Number(text);
}

const MONEY_FMT = "#,##0.00;[Red](#,##0.00)";
const RATIO_FMT = "0.00";
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D7A5F" } } as const;

export interface ExportSpreadRow {
  label: string;
  depth: number;
  computed: boolean;
  /** periodLabel → integer cents string OR ratio display string. */
  cells: Record<string, { kind: "cents" | "ratio"; value: string }>;
}

export interface ExportData {
  dealName: string;
  entityName: string;
  engineVersion: string;
  policyPackVersion: string;
  generatedAt: string;
  periods: string[];
  incomeStatement: ExportSpreadRow[];
  balanceSheet: ExportSpreadRow[];
  globalCashFlow: ExportSpreadRow[];
  addbacks: {
    category: string;
    state: string;
    amountCents: string;
    note: string | null;
    periodLabel: string | null;
  }[];
  scenario: {
    name: string;
    amountCents: string;
    termMonths: number;
    rateDescription: string;
    annualDebtServiceCents: string | null;
    cfadsCents: string | null;
    dscrDisplay: string | null;
  } | null;
}

function styleHeader(sheet: Worksheet, row: number): void {
  const r = sheet.getRow(row);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = HEADER_FILL;
}

function writeSpreadSheet(
  workbook: Workbook,
  name: string,
  periods: string[],
  rows: ExportSpreadRow[],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.getColumn(1).width = 42;
  sheet.addRow(["Line item", ...periods]);
  styleHeader(sheet, 1);

  for (const row of rows) {
    const values: (string | number | null)[] = [`${"  ".repeat(row.depth)}${row.label}`];
    for (const p of periods) {
      const cell = row.cells[p];
      if (!cell) {
        values.push(null);
      } else if (cell.kind === "cents") {
        values.push(centsToExcelNumber(cell.value));
      } else {
        values.push(Number(cell.value));
      }
    }
    const added = sheet.addRow(values);
    for (let i = 2; i <= periods.length + 1; i++) {
      const cell = row.cells[periods[i - 2]!];
      added.getCell(i).numFmt = cell?.kind === "ratio" ? RATIO_FMT : MONEY_FMT;
    }
    if (row.computed) {
      added.font = { bold: true, color: { argb: "FF7C3AED" } }; // violet computed rows
    }
  }
  for (let i = 2; i <= periods.length + 1; i++) sheet.getColumn(i).width = 16;
}

export function buildWorkbook(data: ExportData): Workbook {
  const workbook = new Workbook();
  workbook.creator = "Credexis";
  workbook.created = new Date(data.generatedAt);

  writeSpreadSheet(workbook, "Spread", data.periods, data.incomeStatement);
  writeSpreadSheet(workbook, "Balance Sheet", data.periods, data.balanceSheet);
  writeSpreadSheet(workbook, "Global CF", data.periods, data.globalCashFlow);

  // ── Addbacks ─────────────────────────────────────────────────────────
  const addbacks = workbook.addWorksheet("Addbacks");
  addbacks.addRow(["Category", "Period", "State", "Amount", "Note"]);
  styleHeader(addbacks, 1);
  addbacks.getColumn(1).width = 26;
  addbacks.getColumn(4).width = 16;
  addbacks.getColumn(5).width = 48;
  for (const a of data.addbacks) {
    const r = addbacks.addRow([
      a.category.replaceAll("_", " "),
      a.periodLabel ?? "-",
      a.state,
      centsToExcelNumber(a.amountCents),
      a.note ?? "",
    ]);
    r.getCell(4).numFmt = MONEY_FMT;
  }
  // Live formula where feasible: accepted addbacks total.
  const lastRow = addbacks.rowCount;
  if (data.addbacks.length > 0) {
    const totalRow = addbacks.addRow(["Total (accepted rows)", "", "", null, ""]);
    totalRow.getCell(4).value = {
      formula: `SUMIF(C2:C${lastRow},"accepted",D2:D${lastRow})`,
    };
    totalRow.getCell(4).numFmt = MONEY_FMT;
    totalRow.font = { bold: true };
  }

  // ── Pro-Forma ────────────────────────────────────────────────────────
  const proforma = workbook.addWorksheet("Pro-Forma");
  proforma.getColumn(1).width = 34;
  proforma.getColumn(2).width = 18;
  proforma.addRow(["Metric", "Value"]);
  styleHeader(proforma, 1);
  if (data.scenario) {
    const s = data.scenario;
    proforma.addRow(["Scenario", s.name]);
    const loan = proforma.addRow(["Loan amount", centsToExcelNumber(s.amountCents)]);
    loan.getCell(2).numFmt = MONEY_FMT;
    proforma.addRow(["Term (months)", s.termMonths]);
    proforma.addRow(["Rate", s.rateDescription]);
    const cfads = proforma.addRow([
      "CFADS (basis period)",
      s.cfadsCents !== null ? centsToExcelNumber(s.cfadsCents) : null,
    ]);
    cfads.getCell(2).numFmt = MONEY_FMT;
    const ads = proforma.addRow([
      "Annual debt service",
      s.annualDebtServiceCents !== null ? centsToExcelNumber(s.annualDebtServiceCents) : null,
    ]);
    ads.getCell(2).numFmt = MONEY_FMT;
    // Live DSCR formula referencing the CFADS/ADS cells above.
    const dscr = proforma.addRow(["DSCR (business)", null]);
    dscr.getCell(2).value = { formula: `IF(B7=0,"",B6/B7)` };
    dscr.getCell(2).numFmt = RATIO_FMT;
    dscr.font = { bold: true };
    if (s.dscrDisplay !== null) {
      proforma.addRow(["DSCR (engine, authoritative)", Number(s.dscrDisplay)]);
      proforma.getRow(proforma.rowCount).getCell(2).numFmt = RATIO_FMT;
    }
  } else {
    proforma.addRow(["No loan scenario on this deal", ""]);
  }

  // ── Assumptions ──────────────────────────────────────────────────────
  const assumptions = workbook.addWorksheet("Assumptions");
  assumptions.getColumn(1).width = 30;
  assumptions.getColumn(2).width = 52;
  assumptions.addRow(["Field", "Value"]);
  styleHeader(assumptions, 1);
  assumptions.addRow(["Deal", data.dealName]);
  assumptions.addRow(["Entity", data.entityName]);
  assumptions.addRow(["Engine version", data.engineVersion]);
  assumptions.addRow(["Policy pack", data.policyPackVersion]);
  assumptions.addRow(["Generated", data.generatedAt]);
  assumptions.addRow([
    "Note",
    "Authoritative values are integer cents inside Credexis; Excel numbers are display copies.",
  ]);

  return workbook;
}
