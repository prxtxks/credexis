/**
 * Pro-forma projection (M15): the banker's forecast workbook as a pure
 * engine module. Reproduces the method of the Golden Deal's real workbook
 * (JadeRock Capital): a historical base period sets each expense line's
 * share of revenue; projected years scale those shares against projected
 * revenue; fixed lines annualize once and hold; non-cash and non-recurring
 * lines are excluded. Debt service comes from the amortizer; DSCR is
 * CFADS over annual debt service.
 *
 * Iron laws in force: every number is integer cents with banker's rounding
 * at money boundaries (Law #2); this module is pure and server-side only
 * (Law #3); NOTHING here invents values - the base comes from extracted
 * facts, the assumptions are explicit human inputs recorded alongside the
 * result (Law #1). Policy thresholds are the caller's data (Law #8).
 */

import {
  addCents,
  cents,
  divideCentsToDecimal,
  mulCentsByRatio,
  subCents,
  sumCents,
  ZERO_CENTS,
  type Cents,
  type FixedDecimal,
} from "@credexis/shared";
import { amortize, type RateStep } from "../amortization/amortization.js";

/** How one historical line carries into the projection. */
export type LineTreatment =
  | "ratio" // scales with revenue (the workbook's %-of-sales method)
  | "fixed" // annualizes once, then holds flat
  | "excluded"; // non-cash (depreciation) or non-recurring - never projected

export interface ProformaBaseLine {
  key: string;
  label: string;
  /** Total over the base period (NOT annualized - the engine annualizes). */
  amountCents: Cents;
  treatment: LineTreatment;
}

export interface ProformaBase {
  periodLabel: string;
  /** Months the base period covers (9 for a Jan-Sep YTD). 1..12. */
  monthsCovered: number;
  /** Revenue over the base period. */
  revenueCents: Cents;
  lines: ProformaBaseLine[];
}

export interface ProformaAssumptions {
  /**
   * Revenue growth per projected year, basis points, compounding off the
   * annualized base (or `year1RevenueCents` when given). Index 0 = Year 1.
   * [0, 300, 300] = flat Y1, then +3%/yr.
   */
  revenueGrowthBpsByYear: number[];
  /** Explicit Year-1 revenue override (e.g. the banker's own YE estimate). */
  year1RevenueCents?: Cents;
  /** Owner replacement salary - the CFADS deduction (policy-driven input). */
  replacementSalaryCents?: Cents;
}

export interface ProformaLoan {
  amountCents: Cents;
  termMonths: number;
  rateSteps: RateStep[];
  interestOnlyMonths?: number;
}

export interface ProformaLine {
  key: string;
  label: string;
  amountCents: Cents;
}

export interface ProformaYear {
  label: string;
  revenueCents: Cents;
  lines: ProformaLine[];
  operatingExpensesCents: Cents;
  noiCents: Cents;
  cfadsCents: Cents;
  debtServiceCents: Cents;
  /** CFADS / annual debt service, scale 2. Null when there is no debt. */
  dscr: FixedDecimal | null;
}

export interface ProformaResult {
  /** The base period annualized - Year 0, what the history supports. */
  baseAnnualized: { periodLabel: string; revenueCents: Cents; lines: ProformaLine[] };
  years: ProformaYear[];
}

/** YTD × 12/months with banker's rounding. A 12-month base is exact. */
function annualize(amount: Cents, monthsCovered: number): Cents {
  return mulCentsByRatio(amount, 12n, BigInt(monthsCovered));
}

export function projectProforma(
  base: ProformaBase,
  assumptions: ProformaAssumptions,
  loan: ProformaLoan | null,
): ProformaResult {
  if (base.monthsCovered < 1 || base.monthsCovered > 12) {
    throw new Error(`monthsCovered must be 1..12, got ${base.monthsCovered}`);
  }
  if (assumptions.revenueGrowthBpsByYear.length === 0) {
    throw new Error("at least one projected year is required");
  }

  const annualRevenue = annualize(base.revenueCents, base.monthsCovered);
  const projectable = base.lines.filter((l) => l.treatment !== "excluded");
  const baseAnnualized = {
    periodLabel: `${base.periodLabel} (annualized)`,
    revenueCents: annualRevenue,
    lines: projectable.map((l) => ({
      key: l.key,
      label: l.label,
      amountCents: annualize(l.amountCents, base.monthsCovered),
    })),
  };

  // Annual debt service is level across years for a fixed-rate loan; for
  // stepped rates the amortizer's underwriting annualization (12 × the
  // first amortizing payment) is the SBA convention the metrics engine
  // already uses - one convention, one place.
  const debtServiceCents =
    loan === null
      ? ZERO_CENTS
      : amortize({
          principalCents: loan.amountCents,
          termMonths: loan.termMonths,
          rateSteps: loan.rateSteps,
          ...(loan.interestOnlyMonths !== undefined
            ? { interestOnlyMonths: loan.interestOnlyMonths }
            : {}),
        }).annualDebtServiceCents;

  const years: ProformaYear[] = [];
  let revenue: Cents = ZERO_CENTS;
  for (let i = 0; i < assumptions.revenueGrowthBpsByYear.length; i++) {
    const growthBps = BigInt(assumptions.revenueGrowthBpsByYear[i] ?? 0);
    if (i === 0) {
      revenue =
        assumptions.year1RevenueCents !== undefined
          ? assumptions.year1RevenueCents
          : mulCentsByRatio(annualRevenue, 10_000n + growthBps, 10_000n);
    } else {
      revenue = mulCentsByRatio(revenue, 10_000n + growthBps, 10_000n);
    }

    const lines: ProformaLine[] = projectable.map((l) => {
      if (l.treatment === "fixed") {
        return {
          key: l.key,
          label: l.label,
          amountCents: annualize(l.amountCents, base.monthsCovered),
        };
      }
      // ratio: base share of revenue, re-applied to this year's revenue.
      // Exact integer arithmetic - no percentage intermediate to lose
      // precision in (the workbook rounds its percentages; we do not).
      const amount =
        base.revenueCents === 0n
          ? ZERO_CENTS
          : mulCentsByRatio(l.amountCents, revenue, base.revenueCents);
      return { key: l.key, label: l.label, amountCents: amount };
    });

    const opex = sumCents(lines.map((l) => l.amountCents));
    const noi = subCents(revenue, opex);
    const cfads = subCents(noi, assumptions.replacementSalaryCents ?? ZERO_CENTS);
    years.push({
      label: `Year ${i + 1}`,
      revenueCents: revenue,
      lines,
      operatingExpensesCents: opex,
      noiCents: noi,
      cfadsCents: cfads,
      debtServiceCents,
      dscr: debtServiceCents === 0n ? null : divideCentsToDecimal(cfads, debtServiceCents, 2),
    });
  }

  return { baseAnnualized, years };
}

/**
 * Derive default treatments from taxonomy keys - a deterministic seed the
 * UI shows and the human EDITS (never a hidden decision): depreciation
 * and amortization are non-cash, interest belongs to the new debt
 * structure, everything else follows revenue.
 */
export function defaultTreatment(taxonomyKey: string): LineTreatment {
  if (taxonomyKey === "is.opex.depreciation" || taxonomyKey === "is.opex.amortization") {
    return "excluded";
  }
  if (taxonomyKey === "is.other.interest_expense") return "excluded";
  return "ratio";
}

/** Sum a year's projection into the check the reviewer eyeballs first. */
export function proformaTotals(year: ProformaYear): {
  revenueCents: Cents;
  opexCents: Cents;
  noiCents: Cents;
} {
  return {
    revenueCents: year.revenueCents,
    opexCents: year.operatingExpensesCents,
    noiCents: addCents(year.noiCents, cents(0n)),
  };
}
