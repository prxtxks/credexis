import { describe, expect, it } from "vitest";
import { cents, divRoundHalfEven, type Cents } from "@credexis/shared";
import { amortize } from "../amortization/amortization.js";
import { computeMetrics, ENGINE_VERSION } from "./compute.js";
import type { EngineAddback, EngineFact, EngineScenario } from "./types.js";

const c = (v: number | bigint): Cents => cents(BigInt(v));

const E = "entity-1";
const P = "FY2023";
let seq = 0;

function fact(
  taxonomyNodeKey: string,
  valueCents: number,
  over: Partial<EngineFact> = {},
): EngineFact {
  return {
    id: `f-${++seq}`,
    entityId: E,
    periodLabel: P,
    taxonomyNodeKey,
    valueCents: c(valueCents),
    method: "consensus",
    status: "accepted",
    ...over,
  };
}

function addback(
  category: EngineAddback["category"],
  amountCents: number,
  over: Partial<EngineAddback> = {},
): EngineAddback {
  return {
    id: `ab-${++seq}`,
    entityId: E,
    periodLabel: P,
    category,
    state: "accepted",
    amountCents: c(amountCents),
    ...over,
  };
}

const SCENARIO: EngineScenario = {
  amountCents: c(35_000_000), // $350k
  termMonths: 120,
  rateSteps: [{ fromMonth: 1, annualRateBps: 1025 }],
};

/**
 * Baseline income statement (all $, in cents):
 *   revenue items 500k + 100k = 600k · COGS 200k → gross 400k
 *   opex 250k (incl. D&A 30k, officer comp 80k) · other −20k (interest 20k)
 *   pretax 130k · tax 10k · NI 120k
 */
function baselineFacts(): EngineFact[] {
  return [
    fact("is.revenue.product_sales", 50_000_000),
    fact("is.revenue.service_revenue", 10_000_000),
    fact("is.cogs.total", 20_000_000),
    fact("is.opex.total", 25_000_000),
    fact("is.opex.depreciation", 2_000_000),
    fact("is.opex.amortization", 1_000_000),
    fact("is.opex.officer_comp", 8_000_000),
    fact("is.other.total", -2_000_000),
    fact("is.other.interest_expense", 2_000_000),
    fact("is.income_tax", 1_000_000),
  ];
}

function metricOf(result: ReturnType<typeof computeMetrics>, metric: string) {
  return result.metrics.find((m) => m.metric === metric && m.periodLabel === P);
}

function centsOf(result: ReturnType<typeof computeMetrics>, metric: string): bigint | null {
  const m = metricOf(result, metric);
  return m && m.value.kind === "cents" ? BigInt(m.value.cents) : null;
}

function ratioOf(result: ReturnType<typeof computeMetrics>, metric: string): string | null {
  const m = metricOf(result, metric);
  if (!m || m.value.kind !== "ratio") return null;
  return `${m.value.ratio.mantissa}e-${m.value.ratio.scale}`;
}

describe("computeMetrics — income statement DAG", () => {
  it("sums items when no stated total exists, and prefers stated totals when present", () => {
    const summed = computeMetrics({ facts: baselineFacts(), addbacks: [], scenario: null });
    expect(centsOf(summed, "revenue_total")).toBe(60_000_000n); // Σ items

    // A stated total wins even when it disagrees — reconciling the two is
    // G1's job (blocking issue), never the engine silently "fixing" data.
    const stated = computeMetrics({
      facts: [...baselineFacts(), fact("is.revenue.total", 59_000_000)],
      addbacks: [],
      scenario: null,
    });
    expect(centsOf(stated, "revenue_total")).toBe(59_000_000n);
  });

  it("walks gross profit → net income from stated section totals", () => {
    const r = computeMetrics({ facts: baselineFacts(), addbacks: [], scenario: null });
    expect(centsOf(r, "gross_profit")).toBe(40_000_000n); // 600k − 200k
    expect(centsOf(r, "net_income")).toBe(12_000_000n); // 400k − 250k − 20k − 10k
  });

  it("computes EBITDA = NI + interest + taxes + D&A", () => {
    const r = computeMetrics({ facts: baselineFacts(), addbacks: [], scenario: null });
    // 120k + 20k + 10k + 20k + 10k = 180k
    expect(centsOf(r, "ebitda")).toBe(18_000_000n);
  });

  it("uses only accepted facts, highest-authority per node (override beats consensus)", () => {
    const facts = [
      ...baselineFacts(),
      fact("is.income_tax", 99_999_999, { status: "suggested" }), // ignored
      fact("is.income_tax", 88_888_888, { status: "rejected" }), // ignored
      fact("is.income_tax", 1_500_000, { method: "override" }), // wins over consensus
    ];
    const r = computeMetrics({ facts, addbacks: [], scenario: null });
    // NI drops by the extra 5k of tax; EBITDA adds the tax back so it is unchanged.
    expect(centsOf(r, "net_income")).toBe(11_500_000n);
    expect(centsOf(r, "ebitda")).toBe(18_000_000n);
  });
});

describe("computeMetrics — addbacks (ONE model, trap 8)", () => {
  it("SDE adds accepted owner-benefit addbacks to EBITDA; suggested/rejected never count", () => {
    const r = computeMetrics({
      facts: baselineFacts(),
      addbacks: [
        addback("officer_comp", 8_000_000),
        addback("one_time", 1_500_000),
        addback("discretionary", 500_000, { state: "suggested" }), // NOT counted
        addback("rent_adjustment", 700_000, { state: "rejected" }), // NOT counted
      ],
      scenario: null,
    });
    // 180k EBITDA + 80k officer comp + 15k one-time = 275k
    expect(centsOf(r, "sde")).toBe(27_500_000n);
  });

  it("D&A and interest addback categories are the EBITDA bridge — never added twice", () => {
    const r = computeMetrics({
      facts: baselineFacts(),
      addbacks: [
        addback("depreciation_amortization", 3_000_000), // already in EBITDA via facts
        addback("interest", 2_000_000), // already in EBITDA via facts
      ],
      scenario: null,
    });
    expect(centsOf(r, "sde")).toBe(18_000_000n); // = EBITDA exactly
  });

  it("CFADS = SDE − replacement salary from the scenario", () => {
    const r = computeMetrics({
      facts: baselineFacts(),
      addbacks: [addback("officer_comp", 8_000_000)],
      scenario: { ...SCENARIO, replacementSalaryCents: c(6_500_000) },
    });
    // (180k + 80k) − 65k = 195k
    expect(centsOf(r, "cfads")).toBe(19_500_000n);
  });
});

describe("computeMetrics — debt service & DSCR", () => {
  it("annual debt service comes from the amortization module; DSCR is a 2dp ratio", () => {
    const r = computeMetrics({
      facts: baselineFacts(),
      addbacks: [addback("officer_comp", 8_000_000)],
      scenario: { ...SCENARIO, replacementSalaryCents: c(6_500_000) },
    });
    const expectedAds = BigInt(
      amortize({
        principalCents: SCENARIO.amountCents,
        termMonths: SCENARIO.termMonths,
        rateSteps: SCENARIO.rateSteps,
      }).annualDebtServiceCents,
    );

    const ads = r.metrics.find((m) => m.metric === "annual_debt_service");
    expect(ads?.value).toEqual({ kind: "cents", cents: c(expectedAds) });
    expect(ads?.periodLabel).toBeNull(); // scenario-level, not a period metric

    // DSCR = CFADS / ADS at scale 2 with banker's rounding, exactly.
    const expectedMantissa = divRoundHalfEven(19_500_000n * 100n, expectedAds);
    expect(ratioOf(r, "dscr_business")).toBe(`${expectedMantissa}e-2`);
    // Sanity band: ADS ≈ $56k/yr on $350k/10y/10.25% → DSCR ≈ 3.4–3.5.
    expect(Number(expectedMantissa)).toBeGreaterThan(300);
    expect(Number(expectedMantissa)).toBeLessThan(400);
  });

  it("emits loan_amount and term_months for policy evaluation", () => {
    const r = computeMetrics({ facts: [], addbacks: [], scenario: SCENARIO });
    const loan = r.metrics.find((m) => m.metric === "loan_amount");
    expect(loan?.value).toEqual({ kind: "cents", cents: c(35_000_000) });
    const term = r.metrics.find((m) => m.metric === "term_months");
    expect(term?.value).toEqual({ kind: "ratio", ratio: { mantissa: 120n, scale: 0 } });
  });

  it("no scenario → no debt metrics, business metrics still compute", () => {
    const r = computeMetrics({ facts: baselineFacts(), addbacks: [], scenario: null });
    expect(r.metrics.find((m) => m.metric === "annual_debt_service")).toBeUndefined();
    expect(r.metrics.find((m) => m.metric === "dscr_business")).toBeUndefined();
    expect(centsOf(r, "ebitda")).toBe(18_000_000n);
  });
});

describe("computeMetrics — balance sheet", () => {
  const bs = [
    fact("bs.assets.current.cash", 5_000_000),
    fact("bs.assets.current.accounts_receivable", 7_000_000),
    fact("bs.liabilities.current.total", 4_000_000),
    fact("bs.liabilities.total", 20_000_000),
    fact("bs.equity.total", 15_000_000),
    fact("bs.assets.other.intangibles", 2_000_000),
    fact("bs.assets.other.goodwill", 3_000_000),
  ];

  it("working capital, current ratio, TNW, debt/TNW", () => {
    const r = computeMetrics({ facts: bs, addbacks: [], scenario: null });
    expect(centsOf(r, "working_capital")).toBe(8_000_000n); // 120k − 40k
    expect(ratioOf(r, "current_ratio")).toBe("300e-2"); // 120k / 40k = 3.00
    expect(centsOf(r, "tangible_net_worth")).toBe(10_000_000n); // 150k − 20k − 30k
    expect(ratioOf(r, "debt_to_tnw")).toBe("200e-2"); // 200k / 100k = 2.00
  });

  it("guards division: zero denominators omit the ratio instead of throwing", () => {
    const r = computeMetrics({
      facts: [
        fact("bs.assets.current.total", 5_000_000),
        fact("bs.liabilities.total", 20_000_000),
        fact("bs.equity.total", 5_000_000),
        fact("bs.assets.other.goodwill", 5_000_000), // TNW = 0
      ],
      addbacks: [],
      scenario: null,
    });
    expect(metricOf(r, "current_ratio")).toBeUndefined(); // no current liabilities
    expect(metricOf(r, "debt_to_tnw")).toBeUndefined(); // TNW ≤ 0
    expect(centsOf(r, "tangible_net_worth")).toBe(0n);
  });
});

describe("computeMetrics — result envelope", () => {
  it("stamps the engine version and scopes metrics to entity+period", () => {
    const r = computeMetrics({ facts: baselineFacts(), addbacks: [], scenario: null });
    expect(r.engineVersion).toBe(ENGINE_VERSION);
    const ebitda = metricOf(r, "ebitda");
    expect(ebitda?.entityId).toBe(E);
    expect(ebitda?.periodLabel).toBe(P);
  });

  it("computes each entity+period independently", () => {
    const r = computeMetrics({
      facts: [
        fact("is.revenue.product_sales", 10_000_000),
        fact("is.revenue.product_sales", 20_000_000, { periodLabel: "FY2022" }),
        fact("is.revenue.product_sales", 30_000_000, { entityId: "entity-2" }),
      ],
      addbacks: [],
      scenario: null,
    });
    const revs = r.metrics.filter((m) => m.metric === "revenue_total");
    expect(revs).toHaveLength(3);
    const by = (e: string, p: string) =>
      revs.find((m) => m.entityId === e && m.periodLabel === p)?.value;
    expect(by(E, P)).toEqual({ kind: "cents", cents: c(10_000_000) });
    expect(by(E, "FY2022")).toEqual({ kind: "cents", cents: c(20_000_000) });
    expect(by("entity-2", P)).toEqual({ kind: "cents", cents: c(30_000_000) });
  });
});
