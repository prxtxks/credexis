/**
 * @credexis/schema — Drizzle schema + zod contracts (Blueprint §5).
 *
 * The canonical Postgres data model (facts as the spine, full lineage,
 * append-mostly), RLS-backed, plus the zod validators shared across the
 * pipeline. Tables land in M2; this entrypoint is a placeholder until then.
 */

export const SCHEMA_PACKAGE = "@credexis/schema" as const;

export * from "./corpus/ground-truth.js";
export * as db from "./db/index.js";
export * from "./seed/taxonomy.js";
