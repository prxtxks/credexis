/**
 * Synthetic fixture pack (M1.5): 10 programmatically generated PDFs with
 * known layouts and known values, for unit tests of M3–M5 stages.
 *
 * HARD RULE (Iron Law #9): everything here carries `synthetic: true` and is
 * NEVER counted in accuracy claims. The eval harness segregates on that flag.
 *
 * Generation is byte-deterministic (fixed metadata dates, no randomness), so
 * `pdf_sha256` in the committed ground truth stays valid across regenerations.
 * PDFs land in corpus/synthetic/ (gitignored) and can be regenerated any time
 * with `corpus generate-synthetic`.
 */

import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { FormFamily } from "@credexis/schema";

/** Ground-truth field in DISK format (cents as digit strings, pre-zod). */
export interface SyntheticGtField {
  registry_field_id?: string;
  taxonomy_node?: string;
  period: string;
  value_cents: string | null;
  page: number;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface SyntheticFieldSpec {
  registry_field_id?: string;
  taxonomy_node?: string;
  period: string;
  /** Integer cents as digit string (ground-truth disk format); null = blank. */
  value_cents: string | null;
  /** Text drawn on the page for this value (what an extractor must read). */
  rendered: string;
  label: string;
  page: number;
}

export interface SyntheticDocSpec {
  id: string;
  form_family: FormFamily;
  tax_year: number | null;
  title: string;
  /** Extra layout quirk: renders a column gap (M5.1 blank-cell regression). */
  columns?: string[];
  fields: SyntheticFieldSpec[];
}

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 54;
const VALUE_X = 430;
const TOP = 720;
const LINE_H = 22;

function fmtUsd(cents: string): string {
  const negative = cents.startsWith("-");
  const abs = (negative ? cents.slice(1) : cents).padStart(3, "0");
  const dollars = abs.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const tail = abs.slice(-2);
  return `${negative ? "(" : ""}${dollars}.${tail}${negative ? ")" : ""}`;
}

interface DrawCtx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
}

function drawHeader(ctx: DrawCtx, spec: SyntheticDocSpec): void {
  ctx.page.drawText(`SYNTHETIC FIXTURE — NOT A REAL DOCUMENT`, {
    x: LEFT,
    y: PAGE_H - 30,
    size: 9,
    font: ctx.bold,
  });
  ctx.page.drawText(spec.title, { x: LEFT, y: PAGE_H - 52, size: 14, font: ctx.bold });
  if (spec.tax_year !== null) {
    ctx.page.drawText(`Tax year ${spec.tax_year}`, {
      x: PAGE_W - 160,
      y: PAGE_H - 52,
      size: 11,
      font: ctx.font,
    });
  }
}

/**
 * Build one synthetic PDF + its ground-truth fields (with bboxes derived from
 * the exact draw coordinates — the layout IS known, so lineage is exact).
 */
export async function buildSyntheticPdf(
  spec: SyntheticDocSpec,
): Promise<{ pdf: Uint8Array; fields: SyntheticGtField[]; pageCount: number }> {
  const doc = await PDFDocument.create();
  // Fixed metadata → byte-deterministic output.
  const epoch = new Date(0);
  doc.setTitle(spec.title);
  doc.setProducer("credexis-synthetic-generator");
  doc.setCreator("credexis-synthetic-generator");
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageCount = Math.max(...spec.fields.map((f) => f.page), 1);
  const pages: PDFPage[] = [];
  for (let i = 0; i < pageCount; i++) pages.push(doc.addPage([PAGE_W, PAGE_H]));

  const gtFields: SyntheticGtField[] = [];
  const rowIndexByPage = new Map<number, number>();

  // Optional multi-column period header (statement-style layouts).
  const columnX = (col: number) => VALUE_X - col * 110;
  if (spec.columns) {
    const p = pages[0];
    if (p) {
      spec.columns.forEach((label, i) => {
        p.drawText(label, {
          x: columnX(spec.columns!.length - 1 - i),
          y: TOP + LINE_H,
          size: 10,
          font: bold,
        });
      });
    }
  }

  for (const f of spec.fields) {
    const page = pages[f.page - 1];
    if (!page) throw new Error(`page ${f.page} missing for ${spec.id}`);
    const row = rowIndexByPage.get(f.page) ?? 0;
    rowIndexByPage.set(f.page, row + 1);
    const y = TOP - row * LINE_H;

    page.drawText(f.label, { x: LEFT, y, size: 10, font });

    if (f.rendered !== "") {
      // Column position: statement columns place by period order; forms use VALUE_X.
      const colIdx = spec.columns ? spec.columns.indexOf(f.period) : -1;
      const x = colIdx >= 0 ? columnX(spec.columns!.length - 1 - colIdx) : VALUE_X;
      page.drawText(f.rendered, { x, y, size: 10, font });

      const width = font.widthOfTextAtSize(f.rendered, 10);
      gtFields.push({
        ...(f.registry_field_id !== undefined ? { registry_field_id: f.registry_field_id } : {}),
        ...(f.taxonomy_node !== undefined ? { taxonomy_node: f.taxonomy_node } : {}),
        period: f.period,
        value_cents: f.value_cents,
        page: f.page,
        bbox: {
          x: x / PAGE_W,
          y: (PAGE_H - y - 10) / PAGE_H,
          w: Math.max(width, 1) / PAGE_W,
          h: 12 / PAGE_H,
        },
      });
    } else {
      // Blank cell: ground truth records null with no bbox (nothing rendered).
      gtFields.push({
        ...(f.registry_field_id !== undefined ? { registry_field_id: f.registry_field_id } : {}),
        ...(f.taxonomy_node !== undefined ? { taxonomy_node: f.taxonomy_node } : {}),
        period: f.period,
        value_cents: null,
        page: f.page,
      });
    }
  }

  for (const p of pages) drawHeader({ page: p, font, bold }, spec);

  const pdf = await doc.save({ useObjectStreams: false });
  return { pdf, fields: gtFields, pageCount };
}

function money(id: string, period: string, label: string, cents: string, page = 1) {
  return {
    registry_field_id: id,
    period,
    value_cents: cents,
    rendered: fmtUsd(cents),
    label,
    page,
  };
}

function stmt(node: string, period: string, label: string, cents: string | null, page = 1) {
  return {
    taxonomy_node: node,
    period,
    value_cents: cents,
    rendered: cents === null ? "" : fmtUsd(cents),
    label,
    page,
  };
}

/** The 10 fixtures. Values are arbitrary but internally consistent constants. */
export const SYNTHETIC_SPECS: SyntheticDocSpec[] = [
  {
    id: "synthetic-1120s-2023-001",
    form_family: "1120S",
    tax_year: 2023,
    title: "Form 1120-S (synthetic) — Widget Services Inc",
    fields: [
      money("f1120s.line1a", "FY2023", "1a  Gross receipts or sales", "125000000"),
      money("f1120s.line2", "FY2023", "2   Cost of goods sold", "61200000"),
      money("f1120s.line7", "FY2023", "7   Compensation of officers", "18000000"),
      money("f1120s.line14", "FY2023", "14  Depreciation (Form 4562)", "3200000"),
      money("f1120s.line21", "FY2023", "21  Ordinary business income", "21054000"),
    ],
  },
  {
    id: "synthetic-1120s-2024-001",
    form_family: "1120S",
    tax_year: 2024,
    title: "Form 1120-S (synthetic) — Widget Services Inc",
    fields: [
      money("f1120s.line1a", "FY2024", "1a  Gross receipts or sales", "141500000"),
      money("f1120s.line2", "FY2024", "2   Cost of goods sold", "68030000"),
      money("f1120s.line7", "FY2024", "7   Compensation of officers", "19500000"),
      money("f1120s.line14", "FY2024", "14  Depreciation (Form 4562)", "2950000"),
      money("f1120s.line21", "FY2024", "21  Ordinary business income", "24810000"),
    ],
  },
  {
    id: "synthetic-1120-2024-001",
    form_family: "1120",
    tax_year: 2024,
    title: "Form 1120 (synthetic) — Acme Holdings Corp",
    fields: [
      money("f1120.line1a", "FY2024", "1a  Gross receipts or sales", "310000000"),
      money("f1120.line2", "FY2024", "2   Cost of goods sold", "180500000"),
      money("f1120.line12", "FY2024", "12  Compensation of officers", "24000000"),
      money("f1120.line28", "FY2024", "28  Taxable income before NOL", "38250000"),
    ],
  },
  {
    id: "synthetic-1065-2024-001",
    form_family: "1065",
    tax_year: 2024,
    title: "Form 1065 (synthetic) — Riverbend Partners LLC",
    fields: [
      money("f1065.line1a", "FY2024", "1a  Gross receipts or sales", "98000000"),
      money("f1065.line2", "FY2024", "2   Cost of goods sold", "41300000"),
      money("f1065.line16a", "FY2024", "16a Depreciation", "5100000"),
      money("f1065.line22", "FY2024", "22  Ordinary business income", "18730000"),
    ],
  },
  {
    id: "synthetic-1040-2024-001",
    form_family: "1040",
    tax_year: 2024,
    title: "Form 1040 (synthetic) — J. Guarantor",
    fields: [
      money("f1040.line1a", "FY2024", "1a  Wages (W-2 box 1)", "9850000"),
      money("f1040.line8", "FY2024", "8   Additional income (Sch 1)", "2210000"),
      money("f1040.line9", "FY2024", "9   Total income", "12060000"),
      money("f1040.line15", "FY2024", "15  Taxable income", "9310000"),
    ],
  },
  {
    id: "synthetic-w2-2024-001",
    form_family: "W2",
    tax_year: 2024,
    title: "Form W-2 (synthetic) — J. Guarantor / Widget Services Inc",
    fields: [
      money("w2.box1", "FY2024", "Box 1  Wages, tips, other comp", "9850000"),
      money("w2.box2", "FY2024", "Box 2  Federal income tax withheld", "1477500"),
      money("w2.box5", "FY2024", "Box 5  Medicare wages", "9850000"),
    ],
  },
  {
    id: "synthetic-4562-2024-001",
    form_family: "4562",
    tax_year: 2024,
    title: "Form 4562 (synthetic) — Widget Services Inc",
    fields: [
      money("f4562.line1", "FY2024", "1   Maximum amount (Sec 179)", "122000000"),
      money("f4562.line12", "FY2024", "12  Section 179 expense deduction", "1800000"),
      money("f4562.line22", "FY2024", "22  Total depreciation", "2950000"),
    ],
  },
  {
    id: "synthetic-pnl-quickbooks-001",
    form_family: "PNL",
    tax_year: null,
    title: "Profit & Loss (synthetic, QuickBooks-style) — Widget Services Inc",
    columns: ["FY2023", "FY2024"],
    fields: [
      stmt("revenue.total", "FY2023", "Total Income", "125000000"),
      stmt("revenue.total", "FY2024", "Total Income", "141500000"),
      stmt("cogs.total", "FY2023", "Total COGS", "61200000"),
      stmt("cogs.total", "FY2024", "Total COGS", "68030000"),
      stmt("opex.rent", "FY2023", "Rent Expense", "9600000"),
      stmt("opex.rent", "FY2024", "Rent Expense", "9900000"),
      stmt("net_income", "FY2023", "Net Income", "21054000"),
      stmt("net_income", "FY2024", "Net Income", "24810000"),
    ],
  },
  {
    // THE trap-1 regression fixture: FY2023 has a blank cell in the middle
    // column position. Geometric binding must NOT shift FY2024 values left.
    id: "synthetic-pnl-blankcell-001",
    form_family: "PNL",
    tax_year: null,
    title: "Profit & Loss (synthetic, blank middle cell) — Riverbend Partners",
    columns: ["FY2023", "FY2024"],
    fields: [
      stmt("revenue.total", "FY2023", "Total Income", "88000000"),
      stmt("revenue.total", "FY2024", "Total Income", "98000000"),
      stmt("opex.officer_comp", "FY2023", "Officer Compensation", null), // blank!
      stmt("opex.officer_comp", "FY2024", "Officer Compensation", "16000000"),
      stmt("net_income", "FY2023", "Net Income", "15200000"),
      stmt("net_income", "FY2024", "Net Income", "18730000"),
    ],
  },
  {
    id: "synthetic-balancesheet-001",
    form_family: "BALANCE_SHEET",
    tax_year: null,
    title: "Balance Sheet (synthetic, CPA-style) — Widget Services Inc",
    columns: ["FY2024"],
    fields: [
      stmt("assets.current.cash", "FY2024", "Cash and equivalents", "18500000"),
      stmt("assets.current.ar", "FY2024", "Accounts receivable", "12750000"),
      stmt("assets.total", "FY2024", "TOTAL ASSETS", "64250000"),
      stmt("liabilities.total", "FY2024", "TOTAL LIABILITIES", "29800000"),
      stmt("equity.total", "FY2024", "TOTAL EQUITY", "34450000"),
    ],
  },
];
