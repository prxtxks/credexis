import { describe, expect, it } from "vitest";
import { cents, type Cents } from "@credexis/shared";
import { projectProforma, type ProformaBase } from "./proforma.js";

const c = (n: number | bigint): Cents => cents(BigInt(n));

/**
 * The acceptance fixture is the REAL banker's workbook from Golden Deal 1
 * (JadeRock Capital's "Forecasting - Proforma.xlsx"): 2025 Jan-Sep
 * actuals, expenses projected as a share of gross sales. Our engine must
 * reproduce their arithmetic from the same base - that workbook is the
 * "final result" the product replaces.
 */
const JADEROCK_BASE: ProformaBase = {
  periodLabel: "2025 Jan-Sep",
  monthsCovered: 9,
  revenueCents: c(34_851_771), // $348,517.71 gross sales
  lines: [
    // $1,069.00 advertising over the base period, projected as a ratio.
    {
      key: "is.opex.marketing_advertising",
      label: "Advertising",
      amountCents: c(106_900),
      treatment: "ratio",
    },
    // $11,783.58 insurance - ratio in their model too.
    { key: "is.opex.insurance", label: "Insurance", amountCents: c(1_178_358), treatment: "ratio" },
    // Depreciation is non-cash: excluded from the operating projection.
    {
      key: "is.opex.depreciation",
      label: "Depreciation",
      amountCents: c(3_558_200),
      treatment: "excluded",
    },
  ],
};

describe("projectProforma (M15) - the banker's workbook, reproduced", () => {
  it("linear annualization: YTD × 12/months, banker's rounding", () => {
    const p = projectProforma(JADEROCK_BASE, { revenueGrowthBpsByYear: [0] }, null);
    // 34,851,771 × 12/9 = 46,469,028
    expect(p.baseAnnualized.revenueCents).toBe(46_469_028n);
  });

  it("ratio expenses scale with revenue exactly as the workbook's %-of-sales", () => {
    // JadeRock's own YE revenue estimate as the Year-1 target: with revenue
    // pinned to $445,376.98861 ≈ $445,376.99, advertising must land within
    // a cent of their $1,366.09 (they carry more decimal places; we round
    // at the money boundary - Iron Law #2).
    const base: ProformaBase = { ...JADEROCK_BASE, monthsCovered: 9 };
    const p = projectProforma(
      base,
      { revenueGrowthBpsByYear: [0], year1RevenueCents: c(44_537_699) },
      null,
    );
    const adv = p.years[0]!.lines.find((l) => l.key === "is.opex.marketing_advertising")!;
    // 106,900 × 44,537,699 / 34,851,771 = 136,609.41¢ → 136,609¢ - which
    // is $1,366.09, the workbook's printed advertising figure TO THE CENT.
    expect(adv.amountCents).toBe(136_609n);
    const ins = p.years[0]!.lines.find((l) => l.key === "is.opex.insurance")!;
    // 1,178,358 × 44,537,699 / 34,851,771 = 1,505,846.6¢ → within 1¢ of
    // their $15,058.45 (1,505,845¢ printed; they round percentages first).
    expect(ins.amountCents).toBeGreaterThanOrEqual(1_505_845n);
    expect(ins.amountCents).toBeLessThanOrEqual(1_505_847n);
  });

  it("excluded lines never enter the projection", () => {
    const p = projectProforma(JADEROCK_BASE, { revenueGrowthBpsByYear: [0] }, null);
    expect(p.years[0]!.lines.some((l) => l.key === "is.opex.depreciation")).toBe(false);
  });

  it("fixed lines annualize once and stay flat across years", () => {
    const base: ProformaBase = {
      ...JADEROCK_BASE,
      lines: [{ key: "is.opex.rent", label: "Rent", amountCents: c(900_000), treatment: "fixed" }],
    };
    const p = projectProforma(base, { revenueGrowthBpsByYear: [0, 500, 500] }, null);
    // $9,000 over 9 months → $12,000/yr, unchanged while revenue grows 5%/yr.
    for (const y of p.years) {
      expect(y.lines[0]!.amountCents).toBe(1_200_000n);
    }
    expect(p.years[2]!.revenueCents).toBeGreaterThan(p.years[0]!.revenueCents);
  });

  it("growth compounds per-year in basis points", () => {
    const p = projectProforma(JADEROCK_BASE, { revenueGrowthBpsByYear: [0, 300, 300] }, null);
    // Y1 = annualized base; Y2 = Y1 × 1.03; Y3 = Y2 × 1.03 (banker's rounding)
    expect(p.years[0]!.revenueCents).toBe(46_469_028n);
    expect(p.years[1]!.revenueCents).toBe(47_863_099n);
    expect(p.years[2]!.revenueCents).toBe(49_298_992n);
  });

  it("NOI, CFADS, debt service, and DSCR compose with the amortizer", () => {
    const base: ProformaBase = {
      periodLabel: "FY2025",
      monthsCovered: 12,
      revenueCents: c(46_469_028),
      lines: [
        { key: "is.opex.misc", label: "All opex", amountCents: c(30_000_000), treatment: "ratio" },
      ],
    };
    const p = projectProforma(
      base,
      { revenueGrowthBpsByYear: [0], replacementSalaryCents: c(6_000_000) },
      // $1.2M, 25y, 10.5% fixed - an SBA 7(a)-shaped loan.
      {
        amountCents: c(120_000_000),
        termMonths: 300,
        rateSteps: [{ fromMonth: 1, annualRateBps: 1050 }],
      },
    );
    const y1 = p.years[0]!;
    expect(y1.noiCents).toBe(16_469_028n); // revenue − opex
    expect(y1.cfadsCents).toBe(10_469_028n); // − replacement salary
    expect(y1.debtServiceCents).toBeGreaterThan(0n);
    // DSCR = CFADS / annual debt service, as a FixedDecimal
    expect(y1.dscr).not.toBeNull();
    const dscr = Number(y1.dscr!.mantissa) / 10 ** y1.dscr!.scale;
    expect(dscr).toBeGreaterThan(0.5);
    expect(dscr).toBeLessThan(1.5);
  });

  it("zero base revenue cannot divide - ratio lines project to zero, DSCR null without debt", () => {
    const base: ProformaBase = {
      periodLabel: "FY2025",
      monthsCovered: 12,
      revenueCents: c(0),
      lines: [{ key: "is.opex.misc", label: "Opex", amountCents: c(100), treatment: "ratio" }],
    };
    const p = projectProforma(base, { revenueGrowthBpsByYear: [0] }, null);
    expect(p.years[0]!.lines[0]!.amountCents).toBe(0n);
    expect(p.years[0]!.dscr).toBeNull();
  });
});
