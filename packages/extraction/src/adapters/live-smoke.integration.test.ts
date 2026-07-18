/**
 * LIVE vendor smoke (M3.4 prep): runs the real adapters against real vendor
 * APIs with a synthetic 1120-S whose values are KNOWN — the day-one check
 * that the recorded response shapes match reality, and that the whole
 * read→normalize chain lands on the planted cents.
 *
 * Costs real money (pennies) → gated on RUN_LIVE_VENDOR_TESTS=1, never CI.
 * Synthetic document, clearly labeled — not an accuracy claim (Iron Law #9).
 */

import { describe, expect, it } from "vitest";
import { buildSyntheticPdf, SYNTHETIC_SPECS } from "@credexis/corpus-tools";
import { normalizeAmount } from "@credexis/shared";
import { createAdaptersFromEnv } from "../config.js";
import { getRegistryEntry, toFieldRequests } from "../registry/loader.js";
import { assertFieldContract, assertLayoutContract } from "../contract/assertions.js";

const live = process.env["RUN_LIVE_VENDOR_TESTS"] === "1";
const adapters = createAdaptersFromEnv();

const SPEC = SYNTHETIC_SPECS.find((s) => s.id === "synthetic-1120s-2023-001")!;
/** The planted truth: registry field id → integer cents. */
const PLANTED = new Map(SPEC.fields.map((f) => [f.registry_field_id!, BigInt(f.value_cents!)]));

async function doc() {
  const { pdf, pageCount } = await buildSyntheticPdf(SPEC);
  return { bytes: pdf, mimeType: "application/pdf" as const, pageCount };
}

function requestedFields() {
  const entry = getRegistryEntry("1120S", 2023);
  if (!entry) throw new Error("registry entry missing");
  // Only the fields the synthetic doc actually renders.
  return toFieldRequests(entry).filter((f) => PLANTED.has(f.fieldId));
}

describe.skipIf(!live)("LIVE — Anthropic vision extraction (Path 2)", () => {
  it("reads every planted value exactly (extract → normalize → cents)", async () => {
    const adapter = adapters.anthropicVision;
    expect(adapter, "ANTHROPIC_API_KEY missing").not.toBeNull();
    const fields = requestedFields();
    const result = await adapter!.extractFields(await doc(), fields);
    assertFieldContract(result, fields);

    for (const c of result.candidates) {
      const want = PLANTED.get(c.fieldId)!;
      expect(c.valueText, `${c.fieldId} came back null`).not.toBeNull();
      const norm = normalizeAmount(c.valueText!, {
        ...(c.centsBoxText != null ? { centsBox: c.centsBoxText } : {}),
      });
      expect(norm.ok, `${c.fieldId}: "${c.valueText}" failed to normalize`).toBe(true);
      if (norm.ok) expect(norm.cents, c.fieldId).toBe(want);
    }
    expect(result.run.costMicroUsd > 0n).toBe(true);
  }, 120_000);
});

describe.skipIf(!live)("LIVE — Azure Document Intelligence layout", () => {
  it("parses the synthetic PDF into contract-valid pages", async () => {
    const adapter = adapters.azureDocumentIntelligence;
    expect(adapter, "AZURE_DOCUMENT_INTELLIGENCE_* missing").not.toBeNull();
    const result = await adapter!.parseLayout(await doc());
    assertLayoutContract(result);
    // The planted line labels must appear somewhere in the parsed text.
    const allText = result.pages
      .flatMap((p) => [
        ...p.textBlocks.map((t) => t.text),
        ...p.tables.flatMap((t) => t.cells.map((c) => c.text)),
      ])
      .join(" ");
    expect(allText).toContain("Gross receipts");
    expect(allText).toContain("1,250,000");
  }, 180_000);
});

describe.skipIf(!live)("LIVE — Reducto layout parse", () => {
  it("parses the synthetic PDF (recorded shape vs reality — fix here on drift)", async () => {
    const adapter = adapters.reducto;
    expect(adapter, "REDUCTO_API_KEY missing").not.toBeNull();
    const result = await adapter!.parseLayout(await doc());
    assertLayoutContract(result);
  }, 180_000);
});

describe.skipIf(!live)("LIVE — Reducto schema extraction (Path 1)", () => {
  it("reads every planted value exactly, with per-field bbox lineage", async () => {
    const adapter = adapters.reducto;
    expect(adapter, "REDUCTO_API_KEY missing").not.toBeNull();
    const fields = requestedFields();
    const result = await adapter!.extractFields(await doc(), fields);
    assertFieldContract(result, fields);

    for (const c of result.candidates) {
      const want = PLANTED.get(c.fieldId)!;
      expect(c.valueText, `${c.fieldId} came back null`).not.toBeNull();
      const norm = normalizeAmount(c.valueText!);
      expect(norm.ok, `${c.fieldId}: "${c.valueText}" failed to normalize`).toBe(true);
      if (norm.ok) expect(norm.cents, c.fieldId).toBe(want);
      expect(c.bbox, `${c.fieldId} missing bbox lineage`).not.toBeNull();
    }
  }, 180_000);
});
