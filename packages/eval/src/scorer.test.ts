import type { GroundTruthDocument } from "@credexis/schema";
import { groundTruthDocumentSchema } from "@credexis/schema";
import { describe, expect, it } from "vitest";
import { scoreDocument, summarize } from "./scorer.js";
import type { ExtractedField, ExtractionResult } from "./types.js";

function gtDoc(fields: Array<{ id: string; period?: string; cents: string | null }>) {
  return groundTruthDocumentSchema.parse({
    id: "1120s-2023-native-001",
    form_family: "1120S",
    tax_year: 2023,
    entity: "applicant",
    quality: "native",
    synthetic: false,
    pdf_sha256: "a".repeat(64),
    page_count: 1,
    labeled_by: "test",
    labeled_at: "2026-07-11T12:00:00Z",
    fields: fields.map((f) => ({
      registry_field_id: f.id,
      period: f.period ?? "FY2023",
      value_cents: f.cents,
      page: 1,
    })),
  });
}

function ex(
  id: string,
  cents: bigint | null,
  outcome: ExtractedField["outcome"] = "auto_accept",
  period = "FY2023",
): ExtractedField {
  return { registry_field_id: id, period, value_cents: cents, outcome };
}

function result(fields: ExtractedField[], cost = 0n): ExtractionResult {
  return { fields, cost_micro_usd: cost };
}

describe("scoreDocument", () => {
  const gt: GroundTruthDocument = gtDoc([
    { id: "line1", cents: "100" },
    { id: "line2", cents: "200" },
    { id: "line3", cents: null },
  ]);

  it("scores a perfect extraction (incl. null==null as correct)", () => {
    const s = scoreDocument(gt, result([ex("line1", 100n), ex("line2", 200n), ex("line3", null)]));
    expect(s).toMatchObject({
      correct: 3,
      wrong: 0,
      missed: 0,
      spurious: 0,
      silent_wrong: 0,
      auto_accepted: 3,
      auto_accepted_correct: 3,
    });
  });

  it("counts a wrong auto-accepted value as silent wrong (cardinal sin)", () => {
    const s = scoreDocument(gt, result([ex("line1", 999n), ex("line2", 200n), ex("line3", null)]));
    expect(s.wrong).toBe(1);
    expect(s.silent_wrong).toBe(1);
  });

  it("does NOT count a wrong value routed to review as silent (queue working)", () => {
    const s = scoreDocument(
      gt,
      result([ex("line1", 999n, "review"), ex("line2", 200n), ex("line3", null)]),
    );
    expect(s.wrong).toBe(1);
    expect(s.silent_wrong).toBe(0);
  });

  it("treats extracted-null vs truth-value (and vice versa) as wrong", () => {
    const s = scoreDocument(gt, result([ex("line1", null), ex("line3", 5n, "review")]));
    expect(s.wrong).toBe(2);
    expect(s.silent_wrong).toBe(1); // line1 was auto-accepted
  });

  it("counts missed fields", () => {
    const s = scoreDocument(gt, result([ex("line1", 100n)]));
    expect(s.missed).toBe(2);
  });

  it("counts spurious fields (not in ground truth); silent if auto-accepted", () => {
    const s = scoreDocument(gt, result([ex("line1", 100n), ex("line99", 7n)]));
    expect(s.spurious).toBe(1);
    expect(s.silent_wrong).toBe(1);
  });

  it("field identity includes period — same id, different period is spurious", () => {
    const s = scoreDocument(gt, result([ex("line1", 100n, "auto_accept", "FY2022")]));
    expect(s.spurious).toBe(1);
    expect(s.missed).toBe(3);
  });

  it("counts duplicate extractions of one field as spurious", () => {
    const s = scoreDocument(gt, result([ex("line1", 100n), ex("line1", 100n)]));
    expect(s.correct).toBe(1);
    expect(s.spurious).toBe(1);
  });

  it("carries document cost through", () => {
    const s = scoreDocument(gt, result([ex("line1", 100n)], 12345n));
    expect(s.cost_micro_usd).toBe(12345n);
  });
});

describe("summarize", () => {
  const gt = gtDoc([
    { id: "line1", cents: "100" },
    { id: "line2", cents: "200" },
  ]);

  it("computes headline ratios", () => {
    const scores = [
      scoreDocument(gt, result([ex("line1", 100n), ex("line2", 999n, "review")], 1000n)),
    ];
    const m = summarize(scores);
    expect(m.field_precision).toBeCloseTo(0.5); // 1 correct / (1+1)
    expect(m.field_recall).toBeCloseTo(0.5); // 1 / 2 GT fields
    expect(m.auto_accept_precision).toBeCloseTo(1); // the 1 auto-accepted was correct
    expect(m.auto_accept_coverage).toBeCloseTo(0.5);
    expect(m.silent_wrong_count).toBe(0);
    expect(m.cost_micro_usd_total).toBe(1000n);
    expect(m.cost_micro_usd_per_doc).toBe(1000n);
  });

  it("returns nulls (not NaN) on an empty corpus", () => {
    const m = summarize([]);
    expect(m.documents).toBe(0);
    expect(m.field_precision).toBeNull();
    expect(m.auto_accept_precision).toBeNull();
    expect(m.cost_micro_usd_per_doc).toBe(0n);
  });

  it("breaks down per form and per quality", () => {
    const m = summarize([scoreDocument(gt, result([ex("line1", 100n), ex("line2", 200n)]))]);
    expect(m.per_form["1120S"]?.precision).toBe(1);
    expect(m.per_quality["native"]?.fields).toBe(2);
  });
});
