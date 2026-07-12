/**
 * Extraction path stages (M4.2 Path 1 / M4.3 Path 2) — the pure core the
 * Trigger.dev pipeline (M3.1) wraps: route a logical document through an
 * adapter with the registry-derived schema, then through the ONE
 * normalizer, yielding candidates ready for the consensus reconciler
 * (M4.4) plus the extraction_runs accounting row (M3.2).
 *
 * INDEPENDENCE IS STRUCTURAL (M4.3's core requirement): both paths run
 * through this same function, whose signature admits a document, a
 * registry entry, and ONE adapter — there is no parameter through which
 * Path 2 could ever see Path 1's values. The reconciler is the first
 * place the two meet.
 */

import type { DocumentInput, ExtractorAdapter, AdapterRunInfo, FieldCandidate } from "../types.js";
import type { RegistryEntry } from "../registry/types.js";
import { toFieldRequests } from "../registry/loader.js";
import { normalizeCandidates, type NormalizedCandidate } from "../consensus/reconcile.js";

export interface PathExtraction {
  /** Raw adapter candidates (kept for review crops + audit). */
  candidates: FieldCandidate[];
  /** The same candidates after the one normalizer (M3.6). */
  normalized: Map<string, NormalizedCandidate>;
  /** Timing + cost accounting → extraction_runs (M3.2). */
  run: AdapterRunInfo & { startedAt: Date; finishedAt: Date; stage: string };
}

/**
 * Run ONE path. Called once with the Path-1 adapter (vendor) and once,
 * independently, with the Path-2 adapter (vision LLM).
 */
export async function runExtractionPath(
  stage: "path1_vendor" | "path2_llm",
  adapter: ExtractorAdapter,
  doc: DocumentInput,
  entry: RegistryEntry,
): Promise<PathExtraction> {
  const startedAt = new Date();
  const { candidates, run } = await adapter.extractFields(doc, toFieldRequests(entry));
  const finishedAt = new Date();
  return {
    candidates,
    normalized: normalizeCandidates(candidates, entry),
    run: { ...run, startedAt, finishedAt, stage },
  };
}

/**
 * Convenience for the pipeline: both paths, concurrently, independently.
 * Failures are per-path: one path failing must not lose the other's work —
 * a single surviving path still produces review candidates (single_source).
 */
export async function runBothPaths(
  path1Adapter: ExtractorAdapter,
  path2Adapter: ExtractorAdapter,
  doc: DocumentInput,
  entry: RegistryEntry,
): Promise<{
  path1: PathExtraction | { error: string };
  path2: PathExtraction | { error: string };
}> {
  const [r1, r2] = await Promise.allSettled([
    runExtractionPath("path1_vendor", path1Adapter, doc, entry),
    runExtractionPath("path2_llm", path2Adapter, doc, entry),
  ]);
  return {
    path1: r1.status === "fulfilled" ? r1.value : { error: String(r1.reason) },
    path2: r2.status === "fulfilled" ? r2.value : { error: String(r2.reason) },
  };
}
