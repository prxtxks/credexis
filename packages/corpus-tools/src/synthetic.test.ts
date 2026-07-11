import { createHash } from "node:crypto";
import { groundTruthDocumentSchema } from "@credexis/schema";
import { describe, expect, it } from "vitest";
import { buildSyntheticPdf, SYNTHETIC_SPECS } from "./synthetic.js";

describe("SYNTHETIC_SPECS", () => {
  it("contains exactly the 10 fixtures the task list requires", () => {
    expect(SYNTHETIC_SPECS).toHaveLength(10);
    expect(new Set(SYNTHETIC_SPECS.map((s) => s.id)).size).toBe(10);
  });

  it("includes the trap-1 blank-middle-cell P&L regression fixture", () => {
    const spec = SYNTHETIC_SPECS.find((s) => s.id === "synthetic-pnl-blankcell-001");
    expect(spec).toBeDefined();
    const blank = spec!.fields.find((f) => f.value_cents === null);
    expect(blank).toBeDefined();
    expect(blank!.rendered).toBe("");
  });
});

describe("buildSyntheticPdf", () => {
  it("is byte-deterministic (same spec → identical sha256)", async () => {
    const spec = SYNTHETIC_SPECS[0]!;
    const a = await buildSyntheticPdf(spec);
    const b = await buildSyntheticPdf(spec);
    const hash = (u: Uint8Array) => createHash("sha256").update(u).digest("hex");
    expect(hash(a.pdf)).toBe(hash(b.pdf));
  });

  it("produces a parseable PDF with the expected page count", async () => {
    const { pdf, pageCount } = await buildSyntheticPdf(SYNTHETIC_SPECS[0]!);
    expect(pageCount).toBe(1);
    expect(new TextDecoder("latin1").decode(pdf.slice(0, 5))).toBe("%PDF-");
  });

  it("emits ground-truth fields that satisfy the corpus schema", async () => {
    for (const spec of SYNTHETIC_SPECS) {
      const { fields, pageCount } = await buildSyntheticPdf(spec);
      const parsed = groundTruthDocumentSchema.parse({
        id: spec.id,
        form_family: spec.form_family,
        tax_year: spec.tax_year,
        entity: "applicant",
        quality: "native",
        synthetic: true,
        pdf_sha256: "0".repeat(64),
        page_count: pageCount,
        labeled_by: "synthetic-generator",
        labeled_at: "2026-07-11T00:00:00Z",
        fields,
      });
      expect(parsed.synthetic).toBe(true);
      expect(parsed.fields.length).toBe(spec.fields.length);
    }
  });

  it("gives rendered values exact bboxes and blank cells none", async () => {
    const spec = SYNTHETIC_SPECS.find((s) => s.id === "synthetic-pnl-blankcell-001")!;
    const { fields } = await buildSyntheticPdf(spec);
    const blank = fields.find((f) => f.value_cents === null)!;
    const valued = fields.find((f) => f.value_cents !== null)!;
    expect(blank.bbox).toBeUndefined();
    expect(valued.bbox).toBeDefined();
    expect(valued.bbox!.x).toBeGreaterThan(0);
    expect(valued.bbox!.x + valued.bbox!.w).toBeLessThanOrEqual(1);
  });
});
