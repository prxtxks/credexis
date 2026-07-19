import { describe, expect, it } from "vitest";
import { cents, divRoundHalfEven, type Cents } from "@credexis/shared";
import { amortize } from "../amortization/amortization.js";
import { computeMetrics } from "./compute.js";
import type { EngineFact, EngineScenario } from "./types.js";

const c = (v: number | bigint): Cents => cents(BigInt(v));
let seq = 0;

function fact(
  entityId: string,
  taxonomyNodeKey: string,
  valueCents: number,
  periodLabel = "FY2023",
): EngineFact {
  return {
    id: `f-${++seq}`,
    entityId,
    periodLabel,
    taxonomyNodeKey,
    valueCents: c(valueCents),
    method: "consensus",
    status: "accepted",
  };
}

/** Business entity: EBITDA/CFADS = $180k (no addbacks, no replacement). */
const business = (period = "FY2023") => [
  fact("opco", "is.net_income", 12_000_000, period),
  fact("opco", "is.other.interest_expense", 2_000_000, period),
  fact("opco", "is.income_tax", 1_000_000, period),
  fact("opco", "is.opex.depreciation", 2_000_000, period),
  fact("opco", "is.opex.amortization", 1_000_000, period),
];

/** Guarantor: income $200k − outflows $120k = personal CF $80k. */
const guarantor = (period = "FY2023") => [
  fact("guar", "pcf.income.wages", 15_000_000, period),
  fact("guar", "pcf.income.k1", 5_000_000, period),
  fact("guar", "pcf.outflow.living_expenses", 6_000_000, period),
  fact("guar", "pcf.outflow.mortgage", 4_000_000, period),
  fact("guar", "pcf.outflow.federal_taxes", 2_000_000, period),
];

const SCENARIO: EngineScenario = {
  amountCents: c(35_000_000),
  termMonths: 120,
  rateSteps: [{ fromMonth: 1, annualRateBps: 1025 }],
};

const find = (
  r: ReturnType<typeof computeMetrics>,
  metric: string,
  entityId: string | null,
  period: string | null,
) =>
  r.metrics.find((m) => m.metric === metric && m.entityId === entityId && m.periodLabel === period);

describe("computeMetrics — personal cash flow (M7.4)", () => {
  it("aggregates guarantor income − outflows into personal_cash_flow", () => {
    const r = computeMetrics({ facts: guarantor(), addbacks: [], scenario: null });
    expect(find(r, "personal_income_total", "guar", "FY2023")?.value).toEqual({
      kind: "cents",
      cents: c(20_000_000),
    });
    expect(find(r, "personal_outflow_total", "guar", "FY2023")?.value).toEqual({
      kind: "cents",
      cents: c(12_000_000),
    });
    expect(find(r, "personal_cash_flow", "guar", "FY2023")?.value).toEqual({
      kind: "cents",
      cents: c(8_000_000),
    });
  });

  it("a stated pcf total wins over Σ(items), same as every section", () => {
    const r = computeMetrics({
      facts: [...guarantor(), fact("guar", "pcf.income.total", 19_000_000)],
      addbacks: [],
      scenario: null,
    });
    expect(find(r, "personal_income_total", "guar", "FY2023")?.value).toEqual({
      kind: "cents",
      cents: c(19_000_000),
    });
  });

  it("business entities without pcf facts emit no personal metrics", () => {
    const r = computeMetrics({ facts: business(), addbacks: [], scenario: null });
    expect(r.metrics.find((m) => m.metric.startsWith("personal_"))).toBeUndefined();
  });
});

describe("computeMetrics — global cash flow & DSCR (M7.4)", () => {
  it("global cash flow = Σ business CFADS + Σ personal CF, per period, deal-scoped", () => {
    const r = computeMetrics({
      facts: [...business(), ...guarantor()],
      addbacks: [],
      scenario: SCENARIO,
    });
    // 180k CFADS + 80k personal = 260k, entityId null (deal-global).
    expect(find(r, "global_cash_flow", null, "FY2023")?.value).toEqual({
      kind: "cents",
      cents: c(26_000_000),
    });

    const ads = BigInt(
      amortize({
        principalCents: SCENARIO.amountCents,
        termMonths: SCENARIO.termMonths,
        rateSteps: SCENARIO.rateSteps,
      }).annualDebtServiceCents,
    );
    const expected = divRoundHalfEven(26_000_000n * 100n, ads);
    const dscr = find(r, "dscr_global", null, "FY2023");
    expect(dscr?.value).toEqual({
      kind: "ratio",
      ratio: { mantissa: expected, scale: 2 },
    });
  });

  it("periods never blend: each period label gets its own global figures", () => {
    const r = computeMetrics({
      facts: [...business("FY2023"), ...guarantor("FY2022")],
      addbacks: [],
      scenario: SCENARIO,
    });
    expect(find(r, "global_cash_flow", null, "FY2023")?.value).toEqual({
      kind: "cents",
      cents: c(18_000_000), // CFADS only — the guarantor's CF is FY2022
    });
    expect(find(r, "global_cash_flow", null, "FY2022")?.value).toEqual({
      kind: "cents",
      cents: c(8_000_000), // personal CF only
    });
  });

  it("without a scenario there is no dscr_global, but global_cash_flow still computes", () => {
    const r = computeMetrics({
      facts: [...business(), ...guarantor()],
      addbacks: [],
      scenario: null,
    });
    expect(find(r, "global_cash_flow", null, "FY2023")).toBeDefined();
    expect(r.metrics.find((m) => m.metric === "dscr_global")).toBeUndefined();
  });
});
