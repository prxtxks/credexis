/**
 * @credexis/corpus-tools — corpus intake CLI (M1.2) and its pure logic,
 * exported for reuse by the eval harness and tests.
 */

export * from "./intake.js";
export * from "./redaction.js";
export { loadPdf, type LoadedPdf } from "./pdf.js";
export { buildSyntheticPdf, SYNTHETIC_SPECS, type SyntheticDocSpec } from "./synthetic.js";
