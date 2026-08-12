/**
 * Adapter roster (M18.4): ONE place builds the vendor lineup from env, so
 * ingest-document and extract-document cannot drift.
 *
 * ADR-0002 + addendum: Reducto is Path 1 for field extraction - Azure's
 * prebuilt-TAX reader stays banned there (it hallucinated fields on real
 * CPA bundles; a bad reader never stands in). STATEMENT LAYOUT is
 * different: geometry transcription, interpreted entirely by our own
 * mapping chain behind G1/G2 gates - and Azure's prebuilt-layout benched
 * exactly against golden-deal P&Ls with Reducto-derived production facts
 * (2026-08-12: identical values, faithful labels, cell bboxes). So layout
 * runs as a fallback chain: Reducto primary, Azure when Reducto is down.
 */

import {
  AzureDocumentIntelligenceAdapter,
  LayoutFallbackAdapter,
  ReductoAdapter,
  type ExtractorAdapter,
} from "@credexis/extraction";

export function buildReducto(): ExtractorAdapter | null {
  const apiKey = process.env["REDUCTO_API_KEY"];
  return apiKey ? new ReductoAdapter({ apiKey }) : null;
}

export function buildAzureLayout(): ExtractorAdapter | null {
  const endpoint = process.env["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"];
  const apiKey = process.env["AZURE_DOCUMENT_INTELLIGENCE_KEY"];
  return endpoint && apiKey ? new AzureDocumentIntelligenceAdapter({ endpoint, apiKey }) : null;
}

/** The statement-layout chain. Field extraction must NOT use this. */
export function buildStatementLayout(): ExtractorAdapter | null {
  const reducto = buildReducto();
  const azure = buildAzureLayout();
  if (reducto && azure) return new LayoutFallbackAdapter(reducto, azure);
  return reducto ?? azure;
}
