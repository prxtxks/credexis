/**
 * Postgres enums (Drizzle) — the closed vocabularies of Blueprint §5.
 * Changing an enum is a migration, which is the point: these change rarely
 * and deliberately.
 */

import { pgEnum } from "drizzle-orm/pg-core";

/** Roles enforced server-side in tRPC context (M2.3; org_owner M11.2 —
 *  remaining platform roles land with M12 per the pre-pilot cut). */
export const userRole = pgEnum("user_role", ["admin", "underwriter", "viewer", "org_owner"]);

/** Organization types (M11.2) — advisory metadata, never an RLS predicate.
 *  A solo broker is an org of one; upgrade path = invite a member. */
export const orgKind = pgEnum("org_kind", ["lender", "broker_firm", "solo_broker"]);

/** Profile lifecycle (M11.2): deactivation kills access via the RLS
 *  helpers without deleting the row (audit attribution survives). */
export const profileStatus = pgEnum("profile_status", ["active", "deactivated"]);

/** MVP deal types (Blueprint §1). */
export const dealType = pgEnum("deal_type", [
  "business_acquisition",
  "working_capital",
  "real_estate",
  "refinance",
]);

/** Pipeline-board stages (Blueprint §8.2). */
export const dealStatus = pgEnum("deal_status", ["intake", "parsing", "review", "complete"]);

/** Deal entity kinds (Blueprint §1). */
export const entityKind = pgEnum("entity_kind", [
  "applicant",
  "target",
  "guarantor",
  "spouse",
  "epc",
  "oc",
]);

/** Tax structure of a business/person entity. */
export const taxStructure = pgEnum("tax_structure", [
  "c_corp",
  "s_corp",
  "partnership",
  "sole_prop",
  "individual",
]);

export const virusScanStatus = pgEnum("virus_scan_status", [
  "pending",
  "clean",
  "infected",
  "failed",
]);

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "processing",
  "processed",
  "failed",
]);

/** Period kinds — V1 could not represent interim/TTM columns (post-mortem §3). */
export const periodKind = pgEnum("period_kind", ["fiscal_year", "interim", "ttm", "projection"]);

/** How a fact's value was produced (Blueprint §5). */
export const factMethod = pgEnum("fact_method", [
  "vendor",
  "llm",
  "consensus",
  "transcript",
  "override",
  "human",
]);

/** Fact lifecycle — append-mostly; overrides supersede (Iron Law #5). */
export const factStatus = pgEnum("fact_status", [
  "suggested",
  "accepted",
  "overridden",
  "rejected",
]);

export const extractionRunStatus = pgEnum("extraction_run_status", [
  "running",
  "succeeded",
  "failed",
]);

/** ONE addback model (post-mortem trap 8). */
export const addbackCategory = pgEnum("addback_category", [
  "officer_comp",
  "depreciation_amortization",
  "interest",
  "one_time",
  "rent_adjustment",
  "discretionary",
]);

export const addbackState = pgEnum("addback_state", ["suggested", "accepted", "rejected"]);

/** Validation gates G1–G6 (Blueprint §4.5). */
export const validationGate = pgEnum("validation_gate", ["G1", "G2", "G3", "G4", "G5", "G6"]);

export const issueSeverity = pgEnum("issue_severity", ["info", "warning", "error", "critical"]);

export const issueStatus = pgEnum("issue_status", ["open", "resolved", "dismissed"]);

/** Which financial statement a taxonomy node belongs to. */
export const statementKind = pgEnum("statement_kind", [
  "income_statement",
  "balance_sheet",
  "cash_flow",
  "other",
]);

/** Registry field data types (Form Registry, Blueprint §4.2). */
export const registryDtype = pgEnum("registry_dtype", [
  "money",
  "integer",
  "percent",
  "text",
  "date",
]);

/** How a computed metric's value is encoded (money vs ratio — never floats). */
export const metricValueKind = pgEnum("metric_value_kind", ["cents", "ratio"]);

/* ── Borrower portal (M12.1) ─────────────────────────────────────────── */

/** Lifecycle of a borrower invite claim. */
export const borrowerInviteStatus = pgEnum("borrower_invite_status", [
  "pending",
  "active",
  "revoked",
  "expired",
]);

/**
 * Broker-controlled CURATED status shown in the portal. Deliberately NOT
 * deals.status: internal pipeline state must never leak to a borrower.
 */
export const borrowerPortalStatus = pgEnum("borrower_portal_status", [
  "collecting",
  "in_review",
  "complete",
]);

/** A broker's request for one specific document from one borrower. */
export const documentRequestStatus = pgEnum("document_request_status", [
  "open",
  "fulfilled",
  "withdrawn",
]);
