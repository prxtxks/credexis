import { describe, expect, it } from "vitest";
import { cents, makeDecimal } from "@credexis/shared";
import { evaluatePolicy, type PolicyPackInput } from "./evaluate.js";
import { computeMetrics } from "../core/compute.js";
import type { MetricValue } from "../core/types.js";

const ratio = (mantissa: number, scale: number): MetricValue => ({
  kind: "ratio",
  ratio: makeDecimal(BigInt(mantissa), scale),
});
const money = (v: number): MetricValue => ({ kind: "cents", cents: cents(BigInt(v)) });

/** A miniature SOP pack exercising every value encoding. */
const PACK: PolicyPackInput = {
  sopReference: "SOP 50 10 8 (test)",
  reviewStatus: "reviewed",
  reviewedBy: "pratik",
  rules: [
    {
      id: "dscr.standard",
      label: "Min DSCR — standard",
      metric: "dscr_business",
      op: "gte",
      ratio: { mantissa: 115, scale: 2 },
      appliesWhen: { loanAmountCentsGt: "35000000" },
    },
    {
      id: "dscr.small_loan",
      label: "Min DSCR — small loans",
      metric: "dscr_business",
      op: "gte",
      ratio: { mantissa: 110, scale: 2 },
      appliesWhen: { loanAmountCentsLte: "35000000" },
    },
    {
      id: "equity.coc",
      label: "Min equity injection",
      metric: "equity_injection_pct",
      op: "gte",
      bps: 1000,
      appliesWhen: { dealTypes: ["business_acquisition"] },
    },
    {
      id: "term.wc",
      label: "Max term — working capital",
      metric: "term_months",
      op: "lte",
      months: 120,
      appliesWhen: { useOfProceeds: ["working_capital"] },
    },
    {
      id: "loan.max",
      label: "Max 7(a) amount",
      metric: "loan_amount",
      op: "lte",
      cents: "500000000",
      appliesWhen: {},
    },
  ],
};

const DEAL = {
  dealType: "business_acquisition",
  useOfProceeds: ["working_capital"],
  loanAmountCents: cents(30_000_000n), // $300k → small-loan rule applies
};

function metricsWith(over: Record<string, MetricValue> = {}): Record<string, MetricValue> {
  return {
    dscr_business: ratio(134, 2), // 1.34
    equity_injection_pct: ratio(1200, 4), // 12%
    term_months: ratio(120, 0),
    loan_amount: money(30_000_000),
    ...over,
  };
}

describe("evaluatePolicy — rule evaluation", () => {
  it("evaluates each applicable rule to pass with a signed margin", () => {
    const r = evaluatePolicy({ pack: PACK, deal: DEAL, metrics: metricsWith() });
    expect(r.certifiable).toBe(true);
    expect(r.overall).toBe("pass");

    const dscr = r.rules.find((x) => x.ruleId === "dscr.small_loan")!;
    expect(dscr.status).toBe("pass");
    // margin = 1.34 − 1.10 = +0.24
    expect(dscr.margin).toEqual(makeDecimal(24n, 2));

    const term = r.rules.find((x) => x.ruleId === "term.wc")!;
    expect(term.status).toBe("pass");
    expect(term.margin).toEqual(makeDecimal(0n, 0)); // at the cap exactly

    // The standard-DSCR rule does not apply at $300k.
    expect(r.rules.find((x) => x.ruleId === "dscr.standard")).toBeUndefined();
  });

  it("fails a rule and the overall result when a threshold is missed", () => {
    const r = evaluatePolicy({
      pack: PACK,
      deal: DEAL,
      metrics: metricsWith({ dscr_business: ratio(102, 2) }), // 1.02 < 1.10
    });
    expect(r.overall).toBe("fail");
    const dscr = r.rules.find((x) => x.ruleId === "dscr.small_loan")!;
    expect(dscr.status).toBe("fail");
    expect(dscr.margin).toEqual(makeDecimal(-8n, 2)); // 0.08 short
  });

  it("switches DSCR thresholds on the loan-amount boundary", () => {
    const bigDeal = { ...DEAL, loanAmountCents: cents(50_000_000n) }; // $500k
    const r = evaluatePolicy({
      pack: PACK,
      deal: bigDeal,
      metrics: metricsWith({ dscr_business: ratio(112, 2), loan_amount: money(50_000_000) }),
    });
    // 1.12 ≥ 1.10 would pass small-loan, but the standard 1.15 applies → fail.
    expect(r.rules.find((x) => x.ruleId === "dscr.small_loan")).toBeUndefined();
    expect(r.rules.find((x) => x.ruleId === "dscr.standard")!.status).toBe("fail");
  });

  it("marks rules not_evaluable when their metric is missing, without failing the deal", () => {
    const metrics = metricsWith();
    delete metrics["equity_injection_pct"];
    const r = evaluatePolicy({ pack: PACK, deal: DEAL, metrics });
    const equity = r.rules.find((x) => x.ruleId === "equity.coc")!;
    expect(equity.status).toBe("not_evaluable");
    expect(r.overall).toBe("incomplete");
  });
});

describe("evaluatePolicy — draft packs (Iron Law #8)", () => {
  it("refuses to certify under a draft pack, while still showing advisory results", () => {
    const draft: PolicyPackInput = { ...PACK, reviewStatus: "draft", reviewedBy: null };
    const r = evaluatePolicy({ pack: draft, deal: DEAL, metrics: metricsWith() });
    expect(r.certifiable).toBe(false);
    expect(r.overall).toBe("not_certifiable");
    // Advisory evaluation still runs for the UI.
    expect(r.rules.find((x) => x.ruleId === "dscr.small_loan")!.status).toBe("pass");
  });
});

describe("scenario structure metrics feed the policy vocabulary", () => {
  it("emits equity_injection_pct and sba_guaranty_pct from scenario structure", () => {
    const r = computeMetrics({
      facts: [],
      addbacks: [],
      scenario: {
        amountCents: cents(30_000_000n),
        termMonths: 120,
        rateSteps: [{ fromMonth: 1, annualRateBps: 1025 }],
        structure: {
          equityInjectionCents: cents(5_000_000n),
          totalProjectCostCents: cents(40_000_000n),
          sbaGuarantyBps: 8500,
        },
      },
    });
    const equity = r.metrics.find((m) => m.metric === "equity_injection_pct");
    // 50k / 400k = 12.5% → 1250 bps at scale 4.
    expect(equity?.value).toEqual({ kind: "ratio", ratio: makeDecimal(1250n, 4) });
    const guaranty = r.metrics.find((m) => m.metric === "sba_guaranty_pct");
    expect(guaranty?.value).toEqual({ kind: "ratio", ratio: makeDecimal(8500n, 4) });
  });
});
