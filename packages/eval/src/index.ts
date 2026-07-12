/**
 * @credexis/eval — golden-corpus eval harness (M1.4, Blueprint §9).
 * `pnpm eval` runs dist/run-eval.js; these exports are the library surface
 * for tests and future pipeline integration.
 */

export * from "./types.js";
export * from "./scorer.js";
export * from "./report.js";
export * from "./mock-extractors.js";
export { loadCorpus } from "./corpus.js";
export * from "./classification.js";
