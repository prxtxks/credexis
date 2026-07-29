/**
 * Borrower portal tables (M12.1) — see docs/design/platform/05-borrower-portal.md.
 *
 * Identity spine: a borrower is an `auth.users` row with NO `profiles` row,
 * ever. Their entire authority is `borrower_invites.auth_user_id =
 * auth.uid()`, so every existing tenant policy (`tenant_id =
 * current_tenant_id()`) is vacuously false for them — none of those policies
 * is edited by this milestone. This file therefore adds tables that, on their
 * own, nobody can reach: RLS and the definers land in 0026/0027.
 *
 * Import direction: this file imports deals/entities/tenants only.
 * `documents.ts` imports `borrowerInvites` from here — that direction breaks
 * the cycle.
 */

import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { borrowerInviteStatus, borrowerPortalStatus, documentRequestStatus } from "./enums.js";
import { deals, entities } from "./deals.js";
import { tenants } from "./tenancy.js";

/** One checklist line the broker asks this borrower for (snapshot at invite time). */
export interface RequestedItem {
  key: string;
  label: string;
  formFamilies: string[];
}

/**
 * A borrower as a PERSON the org knows — not an email attached to one deal.
 * Created once with a name and email, then reused across every deal they
 * appear on, which is what makes real onboarding possible: contact history,
 * repeat business, and one identity to reason about.
 *
 * Uniqueness is `(tenant_id, lower(email))` — deliberately per-tenant, not
 * global:
 *  - Two lenders may legitimately both work with the same borrower; a global
 *    constraint would make the second one fail for no defensible reason.
 *  - A global constraint is also an information leak: "email already exists"
 *    would tell one tenant that another tenant holds that borrower. Tenant
 *    scoping keeps the existence of a borrower inside the tenant that knows
 *    them.
 *
 * `fullName` is required because it is load-bearing, not paperwork: it is the
 * deterministic prior the M11.6 identity matcher scores printed document
 * names against ("John H Smith" on a 1040 vs the "John Smith" we were told
 * to expect).
 */
export const borrowers = pgTable(
  "borrowers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    /** Optional contact detail; never used for auth. */
    phone: text("phone"),
    /** profiles.id of the staff member who added them (plain uuid, like deals.created_by). */
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("borrowers_tenant_email_uq").on(t.tenantId, sql`lower(${t.email})`),
    index("borrowers_tenant_idx").on(t.tenantId),
  ],
);

export const borrowerInvites = pgTable(
  "borrower_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    /** Deterministic prior for the M11.6 identity matcher when set. */
    entityId: uuid("entity_id").references(() => entities.id),
    /** WHO this invite is for — the durable borrower identity. */
    borrowerId: uuid("borrower_id")
      .notNull()
      .references(() => borrowers.id),
    /**
     * The address this token was BOUND to at mint time. Deliberately a
     * snapshot rather than a join to `borrowers.email`: correcting a typo in
     * a borrower's contact email must never silently re-target a live claim
     * link, because `claim_borrower_invite()` binds on email equality.
     * Re-targeting requires revoking and re-minting — visibly.
     */
    email: text("email").notNull(),
    /** sha256 of the URL token; the raw token is shown once and never stored (0013 pattern). */
    tokenHash: text("token_hash").notNull(),
    /**
     * Bound by claim_borrower_invite(). Deliberately NO foreign key to
     * auth.users: public tables must not depend on the auth schema, and the
     * claim definer is the only writer.
     */
    authUserId: uuid("auth_user_id"),
    status: borrowerInviteStatus("status").notNull().default("pending"),
    /** Broker-controlled CURATED status shown in the portal — NEVER deals.status. */
    portalStatus: borrowerPortalStatus("portal_status").notNull().default("collecting"),
    /**
     * SNAPSHOTS. The portal never reads deals/entities, so an internal rename
     * ("Sunrise — 2nd look, thin DSCR") can never leak to the borrower.
     */
    displayLabel: text("display_label").notNull(),
    entityLabel: text("entity_label"),
    /**
     * Checklist snapshot from checklistFor(deal.type), broker-editable at
     * invite time. Satisfaction is computed ONLY over this invite's own
     * uploads, so a borrower cannot infer what other parties have supplied.
     */
    requestedItems: jsonb("requested_items")
      .$type<RequestedItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Per-invite overrides; NULL = fall back to tenant settings, then defaults. */
    maxDocs: integer("max_docs"),
    maxBytes: bigint("max_bytes", { mode: "bigint" }),
    /** Integer micro-USD (Iron Law #2 — money is never a float). */
    maxCostMicroUsd: bigint("max_cost_micro_usd", { mode: "bigint" }),
    /** profiles.id of the broker who minted it (plain uuid, like deals.created_by). */
    invitedBy: uuid("invited_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("borrower_invites_token_hash_uq").on(t.tokenHash),
    // One live invite per (deal, borrower). Keyed on the borrower identity
    // rather than the typed email, so the same person cannot end up with two
    // parallel live claims on one deal via an address variant.
    uniqueIndex("borrower_invites_live_uq")
      .on(t.dealId, t.borrowerId)
      .where(sql`${t.status} in ('pending','active')`),
    index("borrower_invites_borrower_idx").on(t.borrowerId),
    // The hot index — every borrower helper resolves the invite through it.
    index("borrower_invites_auth_user_idx")
      .on(t.authUserId)
      .where(sql`${t.authUserId} is not null`),
    index("borrower_invites_tenant_idx").on(t.tenantId),
    index("borrower_invites_deal_idx").on(t.dealId),
  ],
);

/**
 * A broker asking one borrower for one thing. `invite_id` is NOT NULL by
 * design: a deal-wide request would be a cross-borrower channel (borrower A
 * learning what borrower B was asked for), so every request is addressed to
 * exactly one invite.
 */
export const documentRequests = pgTable(
  "document_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => borrowerInvites.id),
    note: text("note").notNull(),
    status: documentRequestStatus("status").notNull().default("open"),
    requestedBy: uuid("requested_by").notNull(),
    /** FK added in 0026 (same deliberate deferral as deals.created_by). */
    fulfilledByDocumentId: uuid("fulfilled_by_document_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("document_requests_invite_idx").on(t.inviteId)],
);
