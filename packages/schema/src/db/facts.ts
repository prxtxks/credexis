/**
 * THE SPINE (Blueprint §5): facts with full lineage, extraction runs (cost
 * discipline, standing order #9), and the ONE addback model (trap 8).
 *
 * Facts are append-mostly (Iron Law #5): an override never mutates the
 * extracted fact — it inserts a new fact and points `superseded_by` at it.
 * All money is integer cents in bigint columns (Iron Law #2); JS reads them
 * as bigint via { mode: "bigint" }.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  addbackCategory,
  addbackState,
  extractionRunStatus,
  factMethod,
  factStatus,
} from "./enums.js";
import { deals, entities, periods } from "./deals.js";
import { documents, logicalDocuments } from "./documents.js";
import { taxonomyNodes } from "./reference.js";
import { tenants } from "./tenancy.js";

/** Normalized bbox (0..1, origin top-left) — same convention as the corpus. */
export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id),
    /** Where the value lands in the canonical chart of accounts. */
    taxonomyNodeKey: text("taxonomy_node_key")
      .notNull()
      .references(() => taxonomyNodes.key),
    /**
     * Which registry line produced it (tax forms; null for statements).
     * Lineage addition to Blueprint §5's tuple: G4 cross-form relations and
     * transcript matching (G5) resolve per registry line, not per taxonomy
     * node.
     */
    registryFieldId: text("registry_field_id"),
    /** Integer cents (Iron Law #2). Null is not a fact — omit the row instead. */
    valueCents: bigint("value_cents", { mode: "bigint" }).notNull(),

    // Lineage (Iron Law #5): exactly one source shape is populated —
    // document (logical_document+page+bbox) | transcript line | human input.
    sourceLogicalDocumentId: uuid("source_logical_document_id").references(
      () => logicalDocuments.id,
    ),
    sourcePage: integer("source_page"),
    sourceBbox: jsonb("source_bbox").$type<Bbox>(),
    sourceTranscriptLine: text("source_transcript_line"),

    method: factMethod("method").notNull(),
    /** Extraction confidence 0..1 (a probability, not money → real is fine). */
    confidence: real("confidence"),
    status: factStatus("status").notNull().default("suggested"),
    /** For overrides: what the value was before (audit display). */
    originalValueCents: bigint("original_value_cents", { mode: "bigint" }),
    /** Set on the OLD fact, pointing at its replacement. Never mutate values. */
    supersededBy: uuid("superseded_by"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("facts_tenant_idx").on(t.tenantId),
    index("facts_deal_idx").on(t.dealId),
    index("facts_entity_period_idx").on(t.entityId, t.periodId),
    index("facts_taxonomy_idx").on(t.taxonomyNodeKey),
  ],
);

/**
 * Reproducibility + cost discipline (M3.2, standing order #9): every pipeline
 * stage records timings, versions, and spend. Costs in integer micro-USD
 * (money → bigint; micro keeps sub-cent vendor pricing exact).
 */
export const extractionRuns = pgTable(
  "extraction_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    documentId: uuid("document_id").references(() => documents.id),
    /** Pipeline stage: ingest | split_classify | extract_path1 | … */
    stage: text("stage").notNull(),
    extractorName: text("extractor_name").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    model: text("model"),
    pageCount: integer("page_count"),
    status: extractionRunStatus("status").notNull().default("running"),
    error: text("error"),
    costMicroUsd: bigint("cost_micro_usd", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("extraction_runs_tenant_idx").on(t.tenantId),
    index("extraction_runs_deal_idx").on(t.dealId),
  ],
);

/**
 * ONE addback model (post-mortem trap 8): rule-suggested and human addbacks
 * share this table, differing only in state; the engine reads accepted only.
 */
export const addbacks = pgTable(
  "addbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    /** The fact this adjustment derives from, when there is one. */
    factId: uuid("fact_id").references(() => facts.id),
    category: addbackCategory("category").notNull(),
    state: addbackState("state").notNull().default("suggested"),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("addbacks_tenant_idx").on(t.tenantId), index("addbacks_deal_idx").on(t.dealId)],
);
