/**
 * Global reference data (no tenant_id): taxonomy, form registry, policy packs
 * (Blueprint §5). Content is seeded in M2.6/M4.1; learned_mappings is
 * tenant-scoped with a global fallback (tenant_id null).
 */

import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { registryDtype, statementKind } from "./enums.js";
import { tenants } from "./tenancy.js";

/**
 * Canonical chart of accounts (~200 nodes, SBA-oriented). Keys are stable
 * dotted paths ("opex.officer_comp"); the key IS the primary key so facts and
 * mappings read naturally. Versioned as a whole via `version`.
 */
export const taxonomyNodes = pgTable("taxonomy_nodes", {
  key: text("key").primaryKey(),
  parentKey: text("parent_key"),
  label: text("label").notNull(),
  statement: statementKind("statement").notNull(),
  /** Officer comp, D&A, interest, rent are first-class (Blueprint §4.3). */
  isAddbackRelevant: boolean("is_addback_relevant").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
});

/**
 * Form Registry (Blueprint §4.2): per (form_family, tax_year, field_id) — the
 * antidote to V1's regex-on-"line 31". IRS renumbers lines across years; this
 * table absorbs that. Code never hardcodes a line number.
 */
export const formRegistry = pgTable(
  "form_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formFamily: text("form_family").notNull(),
    taxYear: integer("tax_year").notNull(),
    /** Stable field id, e.g. "f1120s.line21" — what facts and evals key on. */
    fieldId: text("field_id").notNull(),
    lineNumber: text("line_number"),
    label: text("label").notNull(),
    aliases: text("aliases").array().notNull().default([]),
    pageHint: integer("page_hint"),
    dtype: registryDtype("dtype").notNull(),
    /** +1 or −1: how the printed value maps onto the canonical sign. */
    sign: smallint("sign").notNull().default(1),
    /** Where this line lands in the canonical taxonomy (nullable: not all map). */
    taxonomyNodeKey: text("taxonomy_node_key").references(() => taxonomyNodes.key),
    /** Cross-field validation relations, e.g. {"approx_equals": ["line6","-line20"]}. */
    relations: jsonb("relations").$type<Record<string, unknown>>(),
    version: integer("version").notNull().default(1),
  },
  (t) => [uniqueIndex("form_registry_form_year_field").on(t.formFamily, t.taxYear, t.fieldId)],
);

/**
 * Learned label→taxonomy mappings (post-mortem carry-forward #3, tenant-scoped
 * per Blueprint §4.3). tenant_id null = global mapping. Confirmed human
 * corrections write back here so per-tenant LLM usage decays toward zero.
 */
export const learnedMappings = pgTable(
  "learned_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    /** Normalized label text (lowercased, collapsed whitespace). */
    labelNorm: text("label_norm").notNull(),
    taxonomyNodeKey: text("taxonomy_node_key")
      .notNull()
      .references(() => taxonomyNodes.key),
    usageCount: integer("usage_count").notNull().default(1),
    /** Mapping confidence 0..1 (a probability, not money). */
    confidence: real("confidence").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("learned_mappings_tenant_label").on(t.tenantId, t.labelNorm)],
);

/**
 * Versioned SBA Policy Packs (Iron Law #8): SOP 50 10 8 thresholds live here
 * as data, never in code. Old deals keep the pack they were underwritten
 * under.
 */
export const policyPacks = pgTable("policy_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** e.g. "sop-50-10-8@2026-03". */
  version: text("version").notNull().unique(),
  effectiveDate: date("effective_date").notNull(),
  /** Rule set JSON: DSCR minimums, equity injection, term limits, … */
  rules: jsonb("rules").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
