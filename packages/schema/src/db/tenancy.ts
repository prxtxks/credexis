/**
 * Tenancy root: tenants + profiles (Blueprint §5). Every tenant-scoped table
 * in the system carries `tenant_id` referencing tenants — RLS (M2.2) derives
 * the caller's tenant from the JWT and filters on it (Iron Law #7).
 */

import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { orgKind, profileStatus, userRole } from "./enums.js";
import { pgEnum } from "drizzle-orm/pg-core";

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
  /**
   * M11.7: per-user email delivery toggle. Email is an advisory channel —
   * in-app notifications are always written regardless; this only gates
   * whether Resend also delivers them to the inbox. Self-service via the
   * update_own_profile() definer (never a direct RLS UPDATE — admins'
   * profiles_update_manage must not be the only write path, and users
   * must not be able to touch role/status/tenant on their own row).
   */
  emailNotifications: boolean("email_notifications").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Member invites (M11.3, design 01 §4): claims, not accounts — the invitee
 * authenticates themself and accept_invite() (SECURITY DEFINER) converts a
 * matching pending invite into a profiles row. No admin API in request
 * paths (Iron Law #7). Append-mostly: revoke stamps revoked_at, no deletes.
 */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  email: text("email").notNull(),
  role: userRole("role").notNull(),
  /** sha256 of the URL token; the raw token is shown once, never stored. */
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Notification center (M11.5, design 02 §2 — B1/B4/X3 fixes binding):
 * INSERT is never client-reachable (no insert policy; rows are born in
 * SECURITY DEFINER triggers/helpers or the pipeline's service-role writer
 * with explicit tenant checks). Recipients are capability-derived at
 * fan-out time, never "all admins". State is the only client-writable
 * column, on own rows.
 */
export const notificationKind = pgEnum("notification_kind", [
  "member_joined",
  "document_processed",
  "document_failed",
  "identity_review",
  "review_backlog",
  // M12.1: a borrower uploaded to a deal. Emitted by a trigger with a fixed
  // literal title — borrower-supplied text never reaches a staff bell card.
  "borrower_upload",
]);

export const notificationState = pgEnum("notification_state", [
  "unread",
  "read",
  "actioned",
  "dismissed",
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => profiles.id),
  kind: notificationKind("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  /** App-relative only — validated at write time (B1). */
  actionUrl: text("action_url"),
  dealId: uuid("deal_id"),
  state: notificationState("state").notNull().default("unread"),
  /** Collapses repeat events (e.g. one per doc per stage). */
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
