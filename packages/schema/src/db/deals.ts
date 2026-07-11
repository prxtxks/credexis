/**
 * Deals, entities, periods (Blueprint §5). Periods are first-class rows —
 * facts bind to period IDs, never to column positions (Iron Law #4); the
 * period model natively supports FY/interim/TTM/projection (post-mortem §3).
 */

import { date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
