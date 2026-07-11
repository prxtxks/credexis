/**
 * Append-only audit log (Blueprint §5, §11) — bank requirement. Every
 * fact/addback/scenario mutation lands here with before/after. UPDATE/DELETE
 * are revoked at the database level in the M2.2/M2.5 migration; the table is
 * insert-only for every role including the app.
 */

import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy.js";

export const auditLog = pgTable(
  "audit_log",
  {
    /** bigserial: cheap, strictly ordered, append-friendly. */
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** Acting user (null for system/pipeline actions). */
    actorId: uuid("actor_id"),
    /** e.g. "fact.override", "addback.accept", "scenario.update", "export.xlsx". */
    action: text("action").notNull(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_tenant_idx").on(t.tenantId),
    index("audit_log_table_row_idx").on(t.tableName, t.rowId),
  ],
);
