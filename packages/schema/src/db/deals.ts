/**
 * Deals, entities, periods (Blueprint §5). Periods are first-class rows —
 * facts bind to period IDs, never to column positions (Iron Law #4); the
 * period model natively supports FY/interim/TTM/projection (post-mortem §3).
 */

import { boolean, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dealStatus, dealType, entityKind, periodKind, taxStructure } from "./enums.js";
import { policyPacks } from "./reference.js";
import { tenants } from "./tenancy.js";

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    type: dealType("type").notNull(),
    status: dealStatus("status").notNull().default("intake"),
    /** Pinned at creation; SOP revisions never change an in-flight deal (Iron Law #8). */
    /** M9.5: IRS transcripts are additive and feature-flagged per deal. */
    transcriptsEnabled: boolean("transcripts_enabled").notNull().default(false),
    policyPackId: uuid("policy_pack_id")
      .notNull()
      .references(() => policyPacks.id),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deals_tenant_idx").on(t.tenantId)],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    kind: entityKind("kind").notNull(),
    name: text("name").notNull(),
    taxStructure: taxStructure("tax_structure"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entities_tenant_idx").on(t.tenantId), index("entities_deal_idx").on(t.dealId)],
);

export const periods = pgTable(
  "periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    kind: periodKind("kind").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** Canonical display label, e.g. "FY2024", "2025-01..2025-06", "TTM 2025-06". */
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("periods_tenant_idx").on(t.tenantId), index("periods_entity_idx").on(t.entityId)],
);

/**
 * IRS transcript consents (M9.2): one row per entity × provider request —
 * 8821 e-sign status tracking. The provider adapter updates status; the
 * product works with zero rows (M9.5 graceful absence).
 */
export const transcriptConsents = pgTable(
  "transcript_consents",
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
    provider: text("provider").notNull(),
    /** pending → sent → signed → retrieved | failed (plain text — providers differ). */
    status: text("status").notNull().default("pending"),
    /** Provider-side reference (consent/envelope id). Never a secret. */
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transcript_consents_tenant_idx").on(t.tenantId),
    index("transcript_consents_deal_idx").on(t.dealId),
  ],
);
