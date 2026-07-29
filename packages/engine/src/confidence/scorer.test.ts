import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, scoreField, scoreFields, type FieldSignals } from "./scorer.js";

function signals(p: Partial<FieldSignals>): FieldSignals {
  return {
    factId: "f1",
    path1Cents: 150_000_00n,
    path2Cents: 150_000_00n,
    path1Confidence: 0.97,
    path2Confidence: 0.95,
    gateBlocked: false,
    ...p,
  };
}

describe("confidence scorer (M6.2) — every rule fails toward review", () => {
  it("agreement + clean gates + high confidence → auto_accept at min(c1,c2)", () => {
    const r = scoreField(signals({}));
    expect(r.decision).toBe("auto_accept");
    expect(r.confidence).toBeCloseTo(0.95); // min, not average — conservatism
  });

  it("a gate block VETOES auto-accept no matter how perfect the agreement (Iron Law #6)", () => {
    const r = scoreField(signals({ gateBlocked: true, path1Confidence: 1, path2Confidence: 1 }));
    expect(r.decision).toBe("review");
    expect(r.reasons[0]).toMatch(/gate/i);
  });

  it("value disagreement → review, even by one cent", () => {
    const r = scoreField(signals({ path2Cents: 150_000_01n }));
    expect(r.decision).toBe("review");
    expect(r.reasons[0]).toMatch(/disagree/);
  });

  it("single-source (one path absent) → review", () => {
    expect(scoreField(signals({ path2Cents: null })).decision).toBe("review");
    expect(scoreField(signals({ path1Cents: null })).decision).toBe("review");
  });

  it("both confidently absent → auto_accept as absent (null is an answer)", () => {
    const r = scoreField(
      signals({ path1Cents: null, path2Cents: null, path1Confidence: 0.95, path2Confidence: 0.93 }),
    );
    expect(r.decision).toBe("auto_accept");
    expect(r.agreedAbsent).toBe(true);
  });

  it("both absent at rock-bottom confidence → reject (illegible)", () => {
    const r = scoreField(
      signals({ path1Cents: null, path2Cents: null, path1Confidence: 0.2, path2Confidence: 0.1 }),
    );
    expect(r.decision).toBe("reject");
  });

  it("both absent, middling confidence → review (uncertain absence is uncertainty)", () => {
    const r = scoreField(
      signals({ path1Cents: null, path2Cents: null, path1Confidence: 0.6, path2Confidence: 0.5 }),
    );
    expect(r.decision).toBe("review");
  });

  it("agreement below the auto-accept bar → review (threshold boundary exact)", () => {
    // Bar = 0.75 (M6.2 ROC tuning, 2026-07-28 — see scorer.ts header).
    expect(scoreField(signals({ path1Confidence: 0.75, path2Confidence: 0.75 })).decision).toBe(
      "auto_accept",
    ); // exactly at the bar
    expect(scoreField(signals({ path1Confidence: 0.75, path2Confidence: 0.749 })).decision).toBe(
      "review",
    ); // a hair under
  });

  it("thresholds are config, not code — a stricter bar flips the decision", () => {
    const strict = { ...DEFAULT_THRESHOLDS, autoAcceptMin: 0.99 };
    expect(scoreField(signals({}), strict).decision).toBe("review");
  });

  it("out-of-range vendor confidences are clamped, never trusted", () => {
    const r = scoreField(signals({ path1Confidence: 7, path2Confidence: -3 }));
    expect(r.confidence).toBe(0);
    expect(r.decision).toBe("review");
  });

  it("scoreFields maps the batch and every result carries auditable reasons", () => {
    const results = scoreFields([
      signals({ factId: "a" }),
      signals({ factId: "b", gateBlocked: true }),
    ]);
    expect(results.map((r) => [r.factId, r.decision])).toEqual([
      ["a", "auto_accept"],
      ["b", "review"],
    ]);
    expect(results.every((r) => r.reasons.length > 0)).toBe(true);
  });
});
