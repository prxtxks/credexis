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
const DEFAULT_PRIMARY = "#0D7A5F";
const DEFAULT_ACCENT = "#134E3A";

/** "#0D7A5F" → "FF0D7A5F" (exceljs ARGB). Invalid input falls back. */
export function hexToArgb(hex: string, fallback: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  return `FF${(m ? m[1]! : fallback.slice(1)).toUpperCase()}`;
}

/** The bank's identity on the file (M17) - org_branding, optional. */
export interface ExportBranding {
  displayName: string;
  primaryColor: string;
  accentColor: string;
  footerText: string;
}

export interface ExportSpreadRow {
  label: string;
  depth: number;
  computed: boolean;
  /** periodLabel → integer cents string OR ratio display string. */
  cells: Record<string, { kind: "cents" | "ratio"; value: string }>;
}

/** The projected pro-forma (M16) - strings of integer cents, already
 *  computed by the ONE engine path; the sheet renders and cross-checks. */
export interface ExportProforma {
  entityName: string;
  basePeriodLabel: string;
  monthsCovered: number;
  loanScenarioName: string | null;
  growthBpsByYear: number[];
  replacementSalaryCents: string;
  treatments: Record<string, string>;
  baseAnnualized: { revenueCents: string; lines: { label: string; amountCents: string }[] };
  years: {
    label: string;
    revenueCents: string;
    lines: { label: string; amountCents: string }[];
    operatingExpensesCents: string;
    noiCents: string;
    cfadsCents: string;
    debtServiceCents: string;
  }[];
}

export interface ExportData {
  proforma?: ExportProforma;
  branding?: ExportBranding;
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

function styleHeader(sheet: Worksheet, row: number, primaryArgb?: string): void {
  const r = sheet.getRow(row);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: primaryArgb ?? hexToArgb(DEFAULT_PRIMARY, DEFAULT_PRIMARY) },
  };
}

function writeSpreadSheet(
  workbook: Workbook,
  name: string,
  periods: string[],
  rows: ExportSpreadRow[],
  branding?: ExportBranding,
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.getColumn(1).width = 42;
  // Title block (M17): the bank's name leads the sheet when branding is
  // set - the file reads as THEIR work product, not our tool's.
  if (branding && branding.displayName.trim() !== "") {
    const title = sheet.addRow([`${branding.displayName} - ${name}`]);
    title.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    title.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: hexToArgb(branding.accentColor, DEFAULT_ACCENT) },
    };
  }
  sheet.addRow(["Line item", ...periods]);
  styleHeader(
    sheet,
    sheet.rowCount,
    branding ? hexToArgb(branding.primaryColor, DEFAULT_PRIMARY) : undefined,
  );

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

  writeSpreadSheet(workbook, "Spread", data.periods, data.incomeStatement, data.branding);
  writeSpreadSheet(workbook, "Balance Sheet", data.periods, data.balanceSheet, data.branding);
  writeSpreadSheet(workbook, "Global CF", data.periods, data.globalCashFlow, data.branding);

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
  if (data.proforma) {
    writeProformaForecast(proforma, data.proforma);
    const assumptions = workbook.addWorksheet("Assumptions");
    writeAssumptions(assumptions, data);
    writeProformaAssumptions(assumptions, data.proforma);
    return workbook;
  }
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
  writeAssumptions(assumptions, data);

  return workbook;
}

function writeAssumptions(sheet: Worksheet, data: ExportData): void {
  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 52;
  sheet.addRow(["Field", "Value"]);
  styleHeader(sheet, 1);
  sheet.addRow(["Deal", data.dealName]);
  sheet.addRow(["Entity", data.entityName]);
  sheet.addRow(["Engine version", data.engineVersion]);
  sheet.addRow(["Policy pack", data.policyPackVersion]);
  sheet.addRow(["Generated", data.generatedAt]);
  sheet.addRow([
    "Note",
    "Authoritative values are integer cents inside Credexis; Excel numbers are display copies.",
  ]);
  if (data.branding && data.branding.footerText.trim() !== "") {
    sheet.addRow(["Footer", data.branding.footerText]);
  }
}

/**
 * The bank template's forecast anatomy (M16, modeled on the Golden Deal's
 * real workbook): line rows against paired amount + %-of-revenue columns,
 * one pair per year. The % cells and the DSCR row are LIVE formulas
 * referencing the money cells, so a banker can audit the arithmetic in
 * Excel itself - baked percentages are exactly what they distrust.
 */
function writeProformaForecast(sheet: Worksheet, pf: ExportProforma): void {
  const yearCount = pf.years.length;
  sheet.getColumn(1).width = 32;
  for (let i = 0; i < yearCount + 1; i++) {
    sheet.getColumn(2 + i * 2).width = 16;
    sheet.getColumn(3 + i * 2).width = 9;
  }
  const title = sheet.addRow([`Pro-Forma Forecast - ${pf.entityName}`]);
  title.font = { bold: true, size: 13 };

  const header = ["Line", `${pf.basePeriodLabel} (annualized)`, "%"];
  for (const y of pf.years) header.push(y.label, "%");
  sheet.addRow(header);
  styleHeader(sheet, 2);

  // Column letter for pair i (0 = base, 1.. = years): B, D, F, H…
  const colFor = (pair: number): string => String.fromCharCode(66 + pair * 2);

  const REVENUE_ROW = 3;
  const revenueRow = sheet.addRow(["Revenue"]);
  revenueRow.font = { bold: true };
  const setMoney = (row: typeof revenueRow, pair: number, cents: string): void => {
    const cell = row.getCell(2 + pair * 2);
    cell.value = centsToExcelNumber(cents);
    cell.numFmt = MONEY_FMT;
  };
  setMoney(revenueRow, 0, pf.baseAnnualized.revenueCents);
  pf.years.forEach((y, i) => setMoney(revenueRow, i + 1, y.revenueCents));

  // Line rows: Year-1's line list is the projection's vocabulary; the base
  // column shows the annualized historical amount for the same label.
  const baseByLabel = new Map(pf.baseAnnualized.lines.map((l) => [l.label, l.amountCents]));
  const lineLabels = pf.years[0]?.lines.map((l) => l.label) ?? [];
  for (const label of lineLabels) {
    const row = sheet.addRow([label]);
    const rowN = row.number;
    const baseAmount = baseByLabel.get(label);
    if (baseAmount !== undefined) setMoney(row, 0, baseAmount);
    pf.years.forEach((y, i) => {
      const line = y.lines.find((l) => l.label === label);
      if (line) setMoney(row, i + 1, line.amountCents);
    });
    // Paired % cells: amount ÷ the SAME column's revenue (absolute row).
    for (let pair = 0; pair < yearCount + 1; pair++) {
      const col = colFor(pair);
      const cell = row.getCell(3 + pair * 2);
      cell.value = {
        formula: `IF(${col}$${REVENUE_ROW}=0,"",${col}${rowN}/${col}$${REVENUE_ROW})`,
      };
      cell.numFmt = "0.0%";
    }
  }

  const opexRow = sheet.addRow(["Total operating expenses"]);
  opexRow.font = { bold: true };
  pf.years.forEach((y, i) => setMoney(opexRow, i + 1, y.operatingExpensesCents));
  const noiRow = sheet.addRow(["Net operating income"]);
  noiRow.font = { bold: true };
  pf.years.forEach((y, i) => setMoney(noiRow, i + 1, y.noiCents));
  const cfadsRow = sheet.addRow(["CFADS"]);
  cfadsRow.font = { bold: true };
  pf.years.forEach((y, i) => setMoney(cfadsRow, i + 1, y.cfadsCents));
  const dsRow = sheet.addRow(["Debt service"]);
  pf.years.forEach((y, i) => setMoney(dsRow, i + 1, y.debtServiceCents));

  // DSCR: live division of the CFADS and debt-service cells per year.
  const dscrRow = sheet.addRow(["DSCR"]);
  dscrRow.font = { bold: true };
  pf.years.forEach((_, i) => {
    const col = colFor(i + 1);
    const cell = dscrRow.getCell(2 + (i + 1) * 2);
    cell.value = {
      formula: `IF(${col}${dsRow.number}=0,"",${col}${cfadsRow.number}/${col}${dsRow.number})`,
    };
    cell.numFmt = RATIO_FMT;
  });
  if (pf.loanScenarioName) {
    sheet.addRow([]);
    sheet.addRow([`Debt service from scenario: ${pf.loanScenarioName}`]);
  }
}

/** The pro-forma inputs ARE the audit trail - they travel with the file. */
function writeProformaAssumptions(sheet: Worksheet, pf: ExportProforma): void {
  sheet.addRow([]);
  const head = sheet.addRow(["Pro-forma assumptions", ""]);
  head.font = { bold: true };
  sheet.addRow(["Base period", `${pf.basePeriodLabel} (${pf.monthsCovered} months)`]);
  pf.growthBpsByYear.forEach((bps, i) => {
    sheet.addRow([`Y${i + 1} growth`, `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`]);
  });
  sheet.addRow(["Owner replacement salary", centsToExcelNumber(pf.replacementSalaryCents)]);
  sheet.getRow(sheet.rowCount).getCell(2).numFmt = MONEY_FMT;
  for (const [key, treatment] of Object.entries(pf.treatments)) {
    sheet.addRow([key, treatment]);
  }
}
