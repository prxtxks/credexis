/**
 * Tenancy root: tenants + profiles (Blueprint §5). Every tenant-scoped table
 * in the system carries `tenant_id` referencing tenants — RLS (M2.2) derives
 * the caller's tenant from the JWT and filters on it (Iron Law #7).
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userRole } from "./enums.js";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
