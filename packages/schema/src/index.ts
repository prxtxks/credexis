/**
 * @credexis/schema — Drizzle schema + zod contracts (Blueprint §5).
 *
 * The canonical Postgres data model (facts as the spine, full lineage,
 * append-mostly), RLS-backed, plus the zod validators shared across the
 * pipeline, the taxonomy/policy/learned-mapping seeds, and the corpus
 * ground-truth contracts.
 */

export * from "./corpus/ground-truth.js";
export * as db from "./db/index.js";
export * from "./seed/taxonomy.js";
export * from "./seed/policy-pack.js";
export * from "./seed/learned-mappings.js";
