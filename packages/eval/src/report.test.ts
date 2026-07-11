import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOLERANCE,
  findRegressions,
  toBaselineMetrics,
  toJson,
  toMarkdown,
  type Baseline,
  type EvalReport,
} from "./report.js";
import type { MetricsSummary } from "./scorer.js";

function metrics(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    documents: 10,
    ground_truth_fields: 100,
    field_precision: 0.97,
    field_recall: 0.95,
    auto_accept_precision: 0.996,
    auto_accept_coverage: 0.88,
    silent_wrong_count: 0,
    per_form: {},
    per_quality: {},
    cost_micro_usd_total: 50000n,
    cost_micro_usd_per_doc: 5000n,
    ...overrides,
  };
}

function report(real: MetricsSummary | null, synth: MetricsSummary | null = null): EvalReport {
  return {
    version: 1,
    generated_at: "2026-07-11T12:00:00Z",
    extractor: "mock-perfect@1",
    real,
    synthetic_harness_check: synth,
  };
}

function baselineOf(r: EvalReport): Baseline {
  return {
    version: 1,
    extractor: r.extractor,
    real: toBaselineMetrics(r.real),
    synthetic_harness_check: toBaselineMetrics(r.synthetic_harness_check),
  };
}

describe("findRegressions", () => {
  it("passes when current equals baseline", () => {
    const r = report(metrics());
    expect(findRegressions(baselineOf(r), r)).toEqual([]);
  });

  it("fails when precision drops beyond tolerance", () => {
    const base = baselineOf(report(metrics()));
    const regressed = report(metrics({ field_precision: 0.9 }));
    const findings = findRegressions(base, regressed);
    expect(findings.map((f) => f.metric)).toContain("field_precision");
  });

  it("passes when a drop stays within tolerance", () => {
    const base = baselineOf(report(metrics({ field_precision: 0.97 })));
    const ok = report(metrics({ field_precision: 0.97 - DEFAULT_TOLERANCE / 2 }));
    expect(findRegressions(base, ok)).toEqual([]);
  });

  it("ANY real silent wrong fails, even if baseline had some", () => {
    const base = baselineOf(report(metrics({ silent_wrong_count: 2 })));
    const cur = report(metrics({ silent_wrong_count: 1 }));
    const findings = findRegressions(base, cur);
    expect(findings.some((f) => f.metric === "silent_wrong_count")).toBe(true);
  });

  it("fails when the real corpus disappears relative to baseline", () => {
    const base = baselineOf(report(metrics()));
    const findings = findRegressions(base, report(null));
    expect(findings.some((f) => f.section === "real" && f.current === null)).toBe(true);
  });

  it("does not fail when baseline has no real section yet (pre-M1.3)", () => {
    const base = baselineOf(report(null));
    expect(findRegressions(base, report(null))).toEqual([]);
  });

  it("gates the synthetic harness-check section too (wiring check)", () => {
    const base = baselineOf(report(null, metrics()));
    const cur = report(null, metrics({ field_recall: 0.5 }));
    const findings = findRegressions(base, cur);
    expect(findings.some((f) => f.section === "synthetic_harness_check")).toBe(true);
  });
});

describe("serialization", () => {
  it("toJson renders bigint costs as strings", () => {
    const json = toJson({ cost: 5000n });
    expect(JSON.parse(json)).toEqual({ cost: "5000" });
  });

  it("markdown labels synthetic metrics as not-an-accuracy-claim", () => {
    const md = toMarkdown(report(null, metrics()));
    expect(md).toContain("never an accuracy claim");
    expect(md).toContain("No real documents");
  });

  it("markdown renders the real scorecard with percentages", () => {
    const md = toMarkdown(report(metrics()));
    expect(md).toContain("THE scorecard");
    expect(md).toContain("97.00%");
    expect(md).toContain("$0.05"); // 50000 micro-USD total ⇒ 5 cents
  });
});
