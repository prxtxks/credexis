/**
 * Eval harness contracts (M1.4, Blueprint §9). The `EvalExtractor` interface
 * is the seam the real pipeline (M3/M4) plugs into; today only mock extractors
 * implement it.
 */

import type { GroundTruthDocument } from "@credexis/schema";

/** One corpus document as presented to an extractor under evaluation. */
export interface EvalDocument {
  groundTruth: GroundTruthDocument;
  /** Local PDF path if present (PDFs are gitignored; may be absent in CI). */
  pdfPath: string | null;
}

/**
 * Pipeline outcome per field. `review`/`reject` fields go to a human, so a
 * wrong value there is the queue *working*. A wrong value in `auto_accept` is
 * the cardinal sin ("silent wrong") and is tracked as its own metric.
 */
export type FieldOutcome = "auto_accept" | "review" | "reject";

/** One field as produced by the pipeline under evaluation. */
export interface ExtractedField {
  registry_field_id?: string;
  taxonomy_node?: string;
  period: string;
  /** Integer cents; null = extractor asserts the field is blank/absent. */
  value_cents: bigint | null;
  outcome: FieldOutcome;
}

/** Extraction result for one document. */
export interface ExtractionResult {
  fields: ExtractedField[];
  /** Vendor+LLM spend for this document, integer micro-USD (money → bigint). */
  cost_micro_usd: bigint;
}

/** The seam: anything gradeable by the harness. */
export interface EvalExtractor {
  name: string;
  version: string;
  extract(doc: EvalDocument): Promise<ExtractionResult>;
}
