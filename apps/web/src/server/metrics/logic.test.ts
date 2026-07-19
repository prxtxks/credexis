import { describe, expect, it } from "vitest";
import { cents, makeDecimal } from "@credexis/shared";
import { ENGINE_VERSION, type ComputedMetric } from "@credexis/engine";
import { metricInsertRows, scenarioFromRow, type ScenarioRow } from "./logic";

const row = (over: Partial<ScenarioRow> = {}): ScenarioRow => ({
  id: "s-1",
  amount_cents: 35_000_000,
  rate_spec: { type: "prime_spread", spread_bps: 275 },
  term_months: 120,
  structure: { primeBps: 750 },
  ...over,
});

describe("scenarioFromRow", () => {
  it("resolves prime+spread from the scenario's own structure inputs", () => {
    const r = scenarioFromRow(row());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenario.rateSteps).toEqual([{ fromMonth: 1, annualRateBps: 1025 }]);
    expect(BigInt(r.scenario.amountCents)).toBe(35_000_000n);
  });

  it("fails soft (with a reason) when prime_spread has no prime input", () => {
    const r = scenarioFromRow(row({ structure: null }));
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/prime/) });
  });

  it("threads structure and replacement inputs through as Cents", () => {
    const r = scenarioFromRow(
      row({
        rate_spec: { type: "fixed", bps: 1050 },
        structure: {
          replacementSalaryCents: "6500000",
          equityInjectionCents: "5000000",
          totalProjectCostCents: "40000000",
          sbaGuarantyBps: 7500,
          interestOnlyMonths: 3,
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(BigInt(r.scenario.replacementSalaryCents!)).toBe(6_500_000n);
    expect(BigInt(r.scenario.structure!.equityInjectionCents!)).toBe(5_000_000n);
    expect(r.scenario.structure!.sbaGuarantyBps).toBe(7500);
    expect(r.scenario.interestOnlyMonths).toBe(3);
  });
});

describe("metricInsertRows", () => {
  const metrics: ComputedMetric[] = [
    {
      metric: "ebitda",
      entityId: "e-1",
      periodLabel: "FY2023",
      value: { kind: "cents", cents: cents(18_000_000n) },
    },
    {
      metric: "dscr_global",
      entityId: null,
      periodLabel: "FY2023",
      value: { kind: "ratio", ratio: makeDecimal(347n, 2) },
    },
  ];

  it("maps engine output to computed_metrics rows with bigints as strings", () => {
    const rows = metricInsertRows(metrics, {
      tenantId: "t-1",
      dealId: "d-1",
      scenarioId: "s-1",
      engineVersion: ENGINE_VERSION,
      periodIdByCell: new Map([["e-1|FY2023", "p-1"]]),
    });
    expect(rows[0]).toMatchObject({
      metric: "ebitda",
      entity_id: "e-1",
      period_id: "p-1",
      period_label: "FY2023",
      value_kind: "cents",
      value_cents: "18000000",
      ratio_mantissa: null,
      engine_version: ENGINE_VERSION,
    });
    // Deal-global metric: period label without a periods row.
    expect(rows[1]).toMatchObject({
      metric: "dscr_global",
      entity_id: null,
      period_id: null,
      period_label: "FY2023",
      value_kind: "ratio",
      ratio_mantissa: "347",
      ratio_scale: 2,
      value_cents: null,
    });
  });
});
