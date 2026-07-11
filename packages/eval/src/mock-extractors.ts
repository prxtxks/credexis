/**
 * Mock extractors (M1.4 acceptance). Harness plumbing ONLY — they read the
 * ground truth they are graded against, which no real extractor may ever do.
 * `perfect` proves the happy path end-to-end; `noisy` deterministically
 * degrades output to prove the regression gate trips.
 */

import type { EvalDocument, EvalExtractor, ExtractedField, ExtractionResult } from "./types.js";

/** Echoes ground truth verbatim, everything auto-accepted. Zero cost. */
export const perfectExtractor: EvalExtractor = {
  name: "mock-perfect",
  version: "1",
  extract(doc: EvalDocument): Promise<ExtractionResult> {
    const fields: ExtractedField[] = doc.groundTruth.fields.map((f) => ({
      ...(f.registry_field_id !== undefined ? { registry_field_id: f.registry_field_id } : {}),
      ...(f.taxonomy_node !== undefined ? { taxonomy_node: f.taxonomy_node } : {}),
      period: f.period,
      value_cents: f.value_cents,
      outcome: "auto_accept",
    }));
    return Promise.resolve({ fields, cost_micro_usd: 0n });
  },
};

/** Deterministic 32-bit hash (FNV-1a) → seeded decisions per field. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministically corrupts ~1 in 4 fields; corrupted fields alternate
 * between routed-to-review (the system working) and auto-accepted (silent
 * wrong — must trip the gate). Same input → same output, always.
 */
export const noisyExtractor: EvalExtractor = {
  name: "mock-noisy",
  version: "1",
  extract(doc: EvalDocument): Promise<ExtractionResult> {
    const fields: ExtractedField[] = doc.groundTruth.fields.map((f) => {
      const h = fnv1a(
        `${doc.groundTruth.id}|${f.registry_field_id ?? f.taxonomy_node}|${f.period}`,
      );
      const corrupt = h % 4 === 0;
      const silently = h % 8 === 0;
      const value =
        corrupt && f.value_cents !== null
          ? f.value_cents + 100n // off by $1.00
          : f.value_cents;
      return {
        ...(f.registry_field_id !== undefined ? { registry_field_id: f.registry_field_id } : {}),
        ...(f.taxonomy_node !== undefined ? { taxonomy_node: f.taxonomy_node } : {}),
        period: f.period,
        value_cents: value,
        outcome: corrupt && !silently ? "review" : "auto_accept",
      };
    });
    return Promise.resolve({ fields, cost_micro_usd: 1500n * BigInt(doc.groundTruth.page_count) });
  },
};

export const MOCK_EXTRACTORS: Record<string, EvalExtractor> = {
  perfect: perfectExtractor,
  noisy: noisyExtractor,
};
