/**
 * Synthetic 1120-S page one for the source-demo fixture: a fully fictional
 * S-corp return for "Workspace Opco LLC", drawn with pdf-lib at known
 * coordinates so every seeded fact's source_bbox is EXACT - the same
 * technique as packages/corpus-tools/src/synthetic.ts. Zero real data:
 * fictional company, unassigned EIN prefix (00-), demo address, and a
 * printed disclaimer footer. NEVER part of the golden corpus and never
 * counted in accuracy claims (Iron Law #9) - this exists so marketing
 * screenshots need no real document (docs/HANDOFF.md bans those).
 *
 * Generation is byte-deterministic (fixed metadata dates, no randomness),
 * so the content-addressed storage key (sha256) is stable across runs.
 *
 * All figures are internally consistent:
 *   income:      1a 1,850,000 - 2 780,000 = 3/6 1,070,000
 *   deductions:  7..19 sum to 20 950,000
 *   line 21:     1,070,000 - 950,000 = 120,000 (the hero cell)
 * The four facts the spec seeds (lines 12, 13, 14, 21) mirror the M8.9
 * workspace spec's CFADS bridge: 120k NI + 20k interest + 10k tax + 30k
 * D&A = 180k CFADS, so the metrics strip renders the familiar numbers.
 */

import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface DemoFactSpec {
  taxonomyNodeKey: string;
  registryFieldId: string;
  /** Integer cents as digit string (facts.value_cents is bigint). */
  valueCents: string;
  /** 1-based page within the logical document. */
  sourcePage: number;
  /** Normalized 0..1, origin top-left - facts.source_bbox convention. */
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
}

export interface SyntheticFixture {
  pdf: Buffer;
  sha256: string;
  fileName: string;
  formFamily: "1120S";
  taxYear: number;
  pageCount: number;
  facts: DemoFactSpec[];
}

const W = 612;
const H = 792;
const M = 40;
/** Right edge the amount column aligns to. */
const AMT_RIGHT = W - M - 4;
/** The two vertical rules boxing the line-number column before amounts. */
const NUM_COL_L = 452;
const NUM_COL_R = 478;
const ROW_H = 17;

const INK = rgb(0.12, 0.12, 0.14);
const RULE = rgb(0.45, 0.45, 0.5);
const LIGHT = rgb(0.8, 0.8, 0.84);
const FAINT = rgb(0.55, 0.55, 0.6);

/** cents digit string -> "1,850,000.00" (all fixture values are positive). */
function fmtUsd(cents: string): string {
  const abs = cents.padStart(3, "0");
  const dollars = abs.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${dollars}.${abs.slice(-2)}`;
}

interface RowSpec {
  line: string;
  label: string;
  /** null renders a blank amount cell (form realism, no fact). */
  cents: string | null;
  bold?: boolean;
  fact?: { taxonomyNodeKey: string; registryFieldId: string; confidence: number };
}

const INCOME_ROWS: RowSpec[] = [
  { line: "1a", label: "Gross receipts or sales", cents: "185000000" },
  { line: "2", label: "Cost of goods sold (attach Form 1125-A)", cents: "78000000" },
  { line: "3", label: "Gross profit. Subtract line 2 from line 1a", cents: "107000000" },
  { line: "4", label: "Net gain (loss) from Form 4797, line 17 (attach Form 4797)", cents: null },
  { line: "5", label: "Other income (loss) (see instructions - attach statement)", cents: null },
  {
    line: "6",
    label: "Total income (loss). Add lines 3 through 5",
    cents: "107000000",
    bold: true,
  },
];

const DEDUCTION_ROWS: RowSpec[] = [
  { line: "7", label: "Compensation of officers", cents: "18000000" },
  { line: "8", label: "Salaries and wages (less employment credits)", cents: "42000000" },
  { line: "9", label: "Repairs and maintenance", cents: "1800000" },
  { line: "10", label: "Bad debts", cents: null },
  { line: "11", label: "Rents", cents: "9600000" },
  {
    line: "12",
    label: "Taxes and licenses",
    cents: "1000000",
    fact: { taxonomyNodeKey: "is.income_tax", registryFieldId: "f1120s.line12", confidence: 0.97 },
  },
  {
    line: "13",
    label: "Interest (see instructions)",
    cents: "2000000",
    fact: {
      taxonomyNodeKey: "is.other.interest_expense",
      registryFieldId: "f1120s.line13",
      confidence: 0.98,
    },
  },
  {
    line: "14",
    label: "Depreciation not claimed elsewhere on return (attach Form 4562)",
    cents: "3000000",
    fact: {
      taxonomyNodeKey: "is.opex.depreciation",
      registryFieldId: "f1120s.line14",
      confidence: 0.96,
    },
  },
  { line: "15", label: "Depletion (Do not deduct oil and gas depletion.)", cents: null },
  { line: "16", label: "Advertising", cents: "2200000" },
  { line: "17", label: "Pension, profit-sharing, etc., plans", cents: null },
  { line: "18", label: "Employee benefit programs", cents: "3600000" },
  { line: "19", label: "Other deductions (attach statement)", cents: "11800000" },
  { line: "20", label: "Total deductions. Add lines 7 through 19", cents: "95000000", bold: true },
  {
    line: "21",
    label: "Ordinary business income (loss). Subtract line 20 from line 6",
    cents: "12000000",
    bold: true,
    fact: { taxonomyNodeKey: "is.net_income", registryFieldId: "f1120s.line21", confidence: 0.99 },
  },
];

export async function buildWorkspaceOpco1120s(): Promise<SyntheticFixture> {
  const taxYear = 2023;
  const doc = await PDFDocument.create();
  // Fixed metadata -> byte-deterministic output (stable sha256 storage key).
  const epoch = new Date(0);
  doc.setTitle("Form 1120-S (synthetic sample) - Workspace Opco LLC");
  doc.setProducer("credexis-source-demo");
  doc.setCreator("credexis-source-demo");
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([W, H]);

  /** Top-origin y -> pdf-lib baseline y. */
  const at = (yTop: number) => H - yTop;
  const text = (s: string, x: number, yTop: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(s, { x, y: at(yTop), size, font: f, color });
  const textRight = (
    s: string,
    rightX: number,
    yTop: number,
    size: number,
    f: PDFFont = font,
    color = INK,
  ) => text(s, rightX - f.widthOfTextAtSize(s, size), yTop, size, f, color);
  const textCenter = (s: string, yTop: number, size: number, f: PDFFont = font, color = INK) =>
    text(s, (W - f.widthOfTextAtSize(s, size)) / 2, yTop, size, f, color);
  const hline = (yTop: number, x1 = M, x2 = W - M, thickness = 0.8, color = RULE) =>
    page.drawLine({ start: { x: x1, y: at(yTop) }, end: { x: x2, y: at(yTop) }, thickness, color });

  // ── Header band ──
  text("Form", M, 48, 7);
  text("1120-S", M, 72, 21, bold);
  text("Department of the Treasury", M, 82, 6.3, font, FAINT);
  text("Internal Revenue Service", M, 90, 6.3, font, FAINT);
  textCenter("U.S. Income Tax Return for an S Corporation", 56, 11.5, bold);
  textCenter(
    `For calendar year ${taxYear} or tax year beginning ________, ending ________`,
    70,
    6.5,
  );
  textCenter("Go to www.irs.gov/Form1120S for instructions and the latest information.", 80, 6.5);
  textRight("OMB No. 1545-0123", W - M, 48, 7);
  textRight(String(taxYear), W - M, 76, 19, bold);
  hline(96);

  // ── Entity block ── (fictional by construction: 00- EIN prefix is never
  // assigned; the address is a sample-street placeholder.)
  text("Name", M, 108, 6, font, FAINT);
  text("Workspace Opco LLC", M, 122, 11, bold);
  text("Number, street, city, state, and ZIP code", M, 134, 6, font, FAINT);
  text("100 Sample Street, Suite 400, Demoville, CA 94000", M, 146, 9);
  text("D  Employer identification number", 392, 108, 6, font, FAINT);
  text("00-0000000", 392, 121, 10, bold);
  text("E  Date incorporated", 392, 134, 6, font, FAINT);
  text("01/15/2016", 392, 146, 9);
  hline(154);

  // ── Line-item sections ──
  const facts: DemoFactSpec[] = [];
  let yTop = 0;

  const drawRow = (row: RowSpec) => {
    const f = row.bold ? bold : font;
    text(row.line, M + 2, yTop, 7.5, bold);
    text(row.label, M + 26, yTop, 8.5, f);
    // Dotted leader from label end to the line-number box.
    const labelEnd = M + 26 + f.widthOfTextAtSize(row.label, 8.5);
    if (labelEnd < NUM_COL_L - 12) {
      page.drawLine({
        start: { x: labelEnd + 6, y: at(yTop) + 1.5 },
        end: { x: NUM_COL_L - 6, y: at(yTop) + 1.5 },
        thickness: 0.6,
        color: LIGHT,
        dashArray: [1.2, 2.6],
      });
    }
    // Line number repeated inside the narrow box (as on the printed form).
    const numW = font.widthOfTextAtSize(row.line, 7);
    text(row.line, NUM_COL_L + (NUM_COL_R - NUM_COL_L - numW) / 2, yTop, 7);
    if (row.cents !== null) {
      const rendered = fmtUsd(row.cents);
      const size = 9;
      const width = f.widthOfTextAtSize(rendered, size);
      const x = AMT_RIGHT - width;
      text(rendered, x, yTop, size, f);
      if (row.fact) {
        // bbox from the EXACT draw coordinates (top-origin, normalized) -
        // baseline sits at yTop, glyphs extend ~size above it.
        facts.push({
          taxonomyNodeKey: row.fact.taxonomyNodeKey,
          registryFieldId: row.fact.registryFieldId,
          valueCents: row.cents,
          sourcePage: 1,
          bbox: {
            x: x / W,
            y: (yTop - size - 1) / H,
            w: width / W,
            h: (size + 3) / H,
          },
          confidence: row.fact.confidence,
        });
      }
    }
    hline(yTop + 4, M, W - M, 0.4, LIGHT);
    yTop += ROW_H;
  };

  yTop = 170;
  text("Income", M, yTop, 9, bold);
  yTop += 14;
  const rowsTop = yTop - 12;
  for (const row of INCOME_ROWS) drawRow(row);
  text("Deductions (see instructions for limitations)", M, yTop, 9, bold);
  yTop += 14;
  for (const row of DEDUCTION_ROWS) drawRow(row);
  // Vertical rules boxing the line-number column, across both sections.
  for (const x of [NUM_COL_L, NUM_COL_R]) {
    page.drawLine({
      start: { x, y: at(rowsTop) },
      end: { x, y: at(yTop - ROW_H + 4) },
      thickness: 0.6,
      color: LIGHT,
    });
  }

  // ── Signature block ──
  const sigTop = yTop + 18;
  hline(sigTop - 12);
  text("Sign", M, sigTop + 4, 9, bold);
  text("Here", M, sigTop + 14, 9, bold);
  page.drawLine({
    start: { x: 110, y: at(sigTop + 14) },
    end: { x: 330, y: at(sigTop + 14) },
    thickness: 0.7,
    color: RULE,
  });
  text("Signature of officer", 110, sigTop + 22, 6, font, FAINT);
  page.drawLine({
    start: { x: 350, y: at(sigTop + 14) },
    end: { x: 420, y: at(sigTop + 14) },
    thickness: 0.7,
    color: RULE,
  });
  text("Date", 350, sigTop + 22, 6, font, FAINT);
  page.drawLine({
    start: { x: 440, y: at(sigTop + 14) },
    end: { x: W - M, y: at(sigTop + 14) },
    thickness: 0.7,
    color: RULE,
  });
  text("Title", 440, sigTop + 22, 6, font, FAINT);
  text("Managing Member", 448, sigTop + 12, 8);

  // ── Footer ──
  text(`Form 1120-S (${taxYear})`, M, H - 28, 7, font, FAINT);
  textRight("Page 1", W - M, H - 28, 7, font, FAINT);
  textCenter(
    "SYNTHETIC SAMPLE FOR PRODUCT DEMONSTRATION - Workspace Opco LLC is a fictional company. All figures are fictitious. Not a real tax document.",
    H - 16,
    6.2,
    font,
    FAINT,
  );

  const bytes = await doc.save({ useObjectStreams: false });
  const pdf = Buffer.from(bytes);
  return {
    pdf,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    fileName: "workspace-opco-1120s-fy2023.pdf",
    formFamily: "1120S",
    taxYear,
    pageCount: 1,
    facts,
  };
}
