import { groundTruthDocumentSchema } from "@credexis/schema";
import { describe, expect, it } from "vitest";
import { noisyExtractor, perfectExtractor } from "./mock-extractors.js";
import { scoreDocument } from "./scorer.js";
import type { EvalDocument } from "./types.js";

const doc: EvalDocument = {
  pdfPath: null,
  groundTruth: groundTruthDocumentSchema.parse({
    id: "synthetic-1120s-001",
    form_family: "1120S",
    tax_year: 2023,
    entity: "applicant",
    quality: "native",
    synthetic: true,
    pdf_sha256: "a".repeat(64),
    page_count: 3,
    labeled_by: "generator",
    labeled_at: "2026-07-11T12:00:00Z",
    fields: Array.from({ length: 40 }, (_, i) => ({
      registry_field_id: `f1120s.line${i + 1}`,
      period: "FY2023",
      value_cents: String((i + 1) * 1000),
      page: 1,
    })),
  }),
};

describe("perfectExtractor", () => {
  it("reproduces ground truth exactly with zero silent wrongs", async () => {
    const s = scoreDocument(doc.groundTruth, await perfectExtractor.extract(doc));
    expect(s.correct).toBe(40);
    expect(s.wrong + s.missed + s.spurious + s.silent_wrong).toBe(0);
  });
});

describe("noisyExtractor", () => {
  it("is deterministic (same input → identical output)", async () => {
    const a = await noisyExtractor.extract(doc);
    const b = await noisyExtractor.extract(doc);
    expect(a).toEqual(b);
  });

  it("produces wrong values, including silent wrongs (to trip the gate)", async () => {
    const s = scoreDocument(doc.groundTruth, await noisyExtractor.extract(doc));
    expect(s.wrong).toBeGreaterThan(0);
    expect(s.silent_wrong).toBeGreaterThan(0);
    expect(s.correct).toBeGreaterThan(0); // not everything corrupted
  });

  it("reports nonzero cost scaled by page count", async () => {
    const r = await noisyExtractor.extract(doc);
    expect(r.cost_micro_usd).toBe(4500n);
  });
});
