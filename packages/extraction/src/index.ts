/**
 * @credexis/extraction — the ExtractorAdapter seam (Blueprint §4, §10).
 *
 * A thin interface over document-AI vendors. Swapping a vendor is a config
 * change, not a rewrite: everything implements ExtractorAdapter (types.ts),
 * construction is env-gated (config.ts), and the contract assertions in
 * src/contract/ define what any future vendor must satisfy.
 */

export const EXTRACTION_PACKAGE = "@credexis/extraction" as const;

export * from "./types.js";
export * from "./config.js";
export { AnthropicVisionAdapter } from "./adapters/anthropic-vision.js";
export { ReductoAdapter } from "./adapters/reducto.js";
export { AzureDocumentIntelligenceAdapter } from "./adapters/azure-document-intelligence.js";
export * from "./split/signals.js";
export * from "./split/classify.js";
export * from "./split/group.js";
export * from "./registry/types.js";
export * from "./registry/loader.js";
export * from "./consensus/reconcile.js";
export * from "./facts/plan-writes.js";
export * from "./stages/extract-paths.js";
export * from "./statements/grid.js";
export * from "./statements/row-typing.js";
export * from "./statements/period-binding.js";
export * from "./statements/taxonomy-mapper.js";
