/**
 * Tenancy root: tenants + profiles (Blueprint §5). Every tenant-scoped table
 * in the system carries `tenant_id` referencing tenants — RLS (M2.2) derives
 * the caller's tenant from the JWT and filters on it (Iron Law #7).
 */

import { jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { orgKind, profileStatus, userRole } from "./enums.js";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Org type (M11.2): advisory metadata, never an RLS predicate. */
  kind: orgKind("kind").notNull().default("lender"),
  /** MVP 4 LSP-hierarchy seam — always NULL until then; no policy reads it. */
  parentTenantId: uuid("parent_tenant_id").references((): AnyPgColumn => tenants.id),
  /** Org-level operational settings (deal_access_mode, require_mfa, sso …). */
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per Supabase Auth user. `id` equals `auth.users.id`; the FK into
 * the auth schema is added in a hand-written migration (M2.3) because
 * auth.users lives outside this schema's management.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  email: text("email").notNull(),
  fullName: text("full_name"),
  role: userRole("role").notNull().default("underwriter"),
  /** Deactivation kill-switch (M11.2): RLS helpers require 'active'. */
  status: profileStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
