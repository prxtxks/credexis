/**
 * Physical uploads → logical documents → pages (Blueprint §5).
 * A physical `document` is the uploaded file; Stage S (M3.5) splits it into
 * `logical_documents` (one tax form / statement each) with page ranges.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { documentStatus, virusScanStatus } from "./enums.js";
import { borrowerInvites } from "./borrower.js";
import { deals, entities } from "./deals.js";
import { tenants } from "./tenancy.js";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    fileName: text("file_name").notNull(),
    /** Storage object key under the tenant prefix (M2.4). */
    storagePath: text("storage_path").notNull(),
    /** Content hash — dedupe + immutable binding (same idea as the corpus). */
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    mimeType: text("mime_type").notNull(),
    virusScan: virusScanStatus("virus_scan").notNull().default("pending"),
    status: documentStatus("status").notNull().default("uploaded"),
    uploadedBy: uuid("uploaded_by"),
    /**
     * M12.1: set when the bytes arrived through the borrower portal. NULL
     * for staff uploads. Also the dedupe scope key below, and what the
     * pipeline uses to charge the right per-invite ceiling.
     */
    uploadedViaInviteId: uuid("uploaded_via_invite_id").references(() => borrowerInvites.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_tenant_idx").on(t.tenantId),
    index("documents_deal_idx").on(t.dealId),
    // Cross-deal duplicate detection (Stage S) still needs the plain lookup…
    index("documents_sha256_idx").on(t.sha256),
    // …while dedupe within a deal is a hard guarantee (M2.4): re-uploading
    // the same bytes to the same deal is a constraint violation the upload
    // flow (M3.1) turns into "already uploaded".
    //
    // M12.1 — scoped to the WRITER, not the deal. A deal-wide unique index
    // turns the 409 into an existence oracle: a borrower could probe whether
    // the lender already holds a given file (or squat a digest to block a
    // real upload). Org uploads still dedupe against org uploads (the
    // apps/web 23505 → 409 path is unchanged, since their scope key is the
    // constant); each invite dedupes only against itself.
    uniqueIndex("documents_deal_sha256_scope_uq").on(
      t.dealId,
      t.sha256,
      sql`coalesce(${t.uploadedViaInviteId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index("documents_invite_idx")
      .on(t.uploadedViaInviteId)
      .where(sql`${t.uploadedViaInviteId} is not null`),
  ],
);

export const logicalDocuments = pgTable(
  "logical_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    /** Suggested by Stage S, human-confirmable (M6.5). */
    entityId: uuid("entity_id").references(() => entities.id),
    entityConfirmed: boolean("entity_confirmed").notNull().default(false),
    /** Split-stage classifier's entity hint (M11.6): free-text prior for
     *  the identity matcher — advisory only, never an assignment. */
    entityHint: text("entity_hint"),
    /** e.g. "1120S", "PNL" — same vocabulary as the corpus formFamilySchema. */
    formFamily: text("form_family").notNull(),
    taxYear: integer("tax_year"),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("logical_documents_tenant_idx").on(t.tenantId),
    index("logical_documents_document_idx").on(t.documentId),
  ],
);

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    logicalDocumentId: uuid("logical_document_id")
      .notNull()
      .references(() => logicalDocuments.id),
    /** 1-based within the logical document. */
    pageNumber: integer("page_number").notNull(),
    /** Storage keys for the rendered image / OCR text artifacts. */
    imagePath: text("image_path"),
    ocrTextPath: text("ocr_text_path"),
  },
  (t) => [
    index("pages_tenant_idx").on(t.tenantId),
    index("pages_logical_document_idx").on(t.logicalDocumentId),
  ],
);

/**
 * Entity↔document identity matches (M11.6, design 02 §3): one row per
 * (logical document, extracted identity) with the deterministic match
 * score against the deal's best-matching entity. Full lineage (page,
 * method); NEVER stored in facts (identities are not money). Auto-confirm
 * stays OFF pre-pilot: even high-band matches are `suggested` until a
 * human (or the future eval-gated auto band) confirms.
 */
export const documentIdentities = pgTable(
  "document_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    logicalDocumentId: uuid("logical_document_id")
      .notNull()
      .references(() => logicalDocuments.id),
    /** Best-matching deal entity; null = no candidate cleared the floor. */
    entityId: uuid("entity_id").references(() => entities.id),
    /** The name as printed on the document (located, never invented). */
    extractedName: text("extracted_name").notNull(),
    sourcePage: integer("source_page"),
    /** Which reader located it: vendor | llm. */
    method: text("method").notNull(),
    /** Deterministic matcher output (packages/shared name-match). */
    scoreBps: integer("score_bps").notNull(),
    band: text("band").notNull(),
    state: text("state").notNull().default("suggested"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_identities_tenant_idx").on(t.tenantId),
    index("document_identities_ld_idx").on(t.logicalDocumentId),
  ],
);
