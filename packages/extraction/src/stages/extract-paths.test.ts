import { describe, expect, it } from "vitest";
import { getRegistryEntry } from "../registry/loader.js";
import { runBothPaths, runExtractionPath } from "./extract-paths.js";
import type { DocumentInput, ExtractorAdapter, FieldCandidate, FieldRequest } from "../types.js";

const entry = getRegistryEntry("W2", 2023)!;
const DOC: DocumentInput = { bytes: new Uint8Array([1]), mimeType: "application/pdf" };

/** Stub adapter that records exactly what it was given. */
function stubAdapter(name: string, value: string): ExtractorAdapter & { seen: FieldRequest[][] } {
  return {
    name,
    version: "1",
    seen: [] as FieldRequest[][],
    parseLayout: () => Promise.reject(new Error("not used")),
    async extractFields(_doc, fields) {
      this.seen.push(fields);
      const candidates: FieldCandidate[] = fields.map((f) => ({
        fieldId: f.fieldId,
        valueText: f.fieldId === "w2.box1" ? value : null,
        page: f.fieldId === "w2.box1" ? 1 : null,
        bbox: null,
        confidence: 0.9,
      }));
      return {
        candidates,
        run: { vendor: name, vendorVersion: "1", pageCount: 1, costMicroUsd: 100n },
      };
    },
  };
}

describe("extraction path stages (M4.2/M4.3)", () => {
  it("routes the registry-derived schema to the adapter and normalizes output", async () => {
    const adapter = stubAdapter("stub-vendor", "48,500.00");
    const result = await runExtractionPath("path1_vendor", adapter, DOC, entry);

    // Registry-derived schema reached the adapter (all W-2 fields, aliases intact).
    expect(adapter.seen[0]?.map((f) => f.fieldId)).toEqual(entry.fields.map((f) => f.fieldId));
    expect(adapter.seen[0]?.[0]?.aliases).toContain("WagesTipsAndOtherCompensation");

    // value_text → normalizer → cents.
    expect(result.normalized.get("w2.box1")?.cents).toBe(4850000n);
    expect(result.candidates[0]?.valueText).toBe("48,500.00"); // raw preserved
    expect(result.run).toMatchObject({ stage: "path1_vendor", costMicroUsd: 100n });
    expect(result.run.finishedAt.getTime()).toBeGreaterThanOrEqual(result.run.startedAt.getTime());
  });

  it("INDEPENDENCE: each path receives only doc + registry — never the other's output", async () => {
    const p1 = stubAdapter("vendor", "48,500.00");
    const p2 = stubAdapter("llm", "48,500.00");
    await runBothPaths(p1, p2, DOC, entry);

    // Both adapters saw exactly one call whose inputs are the registry
    // schema — structurally identical, containing no candidate values.
    for (const adapter of [p1, p2]) {
      expect(adapter.seen).toHaveLength(1);
      const serialized = JSON.stringify(adapter.seen[0]);
      expect(serialized).not.toContain("valueText");
      expect(serialized).not.toContain("48,500.00".replace("48", "48")); // no values in inputs
    }
  });

  it("one path failing never loses the other's work", async () => {
    const failing: ExtractorAdapter = {
      name: "broken",
      version: "1",
      parseLayout: () => Promise.reject(new Error("x")),
      extractFields: () => Promise.reject(new Error("vendor 500")),
    };
    const ok = stubAdapter("llm", "1,000");
    const { path1, path2 } = await runBothPaths(failing, ok, DOC, entry);
    expect("error" in path1 && path1.error).toMatch(/vendor 500/);
    expect("error" in path2).toBe(false);
    if (!("error" in path2)) {
      expect(path2.normalized.get("w2.box1")?.cents).toBe(100000n);
    }
  });
});
