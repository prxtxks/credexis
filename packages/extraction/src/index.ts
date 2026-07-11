/**
 * @credexis/extraction — the ExtractorAdapter seam (Blueprint §4, §10).
 *
 * A thin interface over document-AI vendors (Reducto, Azure Document
 * Intelligence prebuilt-tax, Anthropic vision consensus). Swapping a vendor is
 * a config change, not a rewrite. Adapters land in M3.3; this entrypoint is a
 * placeholder until then.
 */

export const EXTRACTION_PACKAGE = "@credexis/extraction" as const;
