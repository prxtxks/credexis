/**
 * Physical uploads → logical documents → pages (Blueprint §5).
 * A physical `document` is the uploaded file; Stage S (M3.5) splits it into
 * `logical_documents` (one tax form / statement each) with page ranges.
 */

import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { documentStatus, virusScanStatus } from "./enums.js";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_tenant_idx").on(t.tenantId),
    index("documents_deal_idx").on(t.dealId),
    index("documents_sha256_idx").on(t.sha256),
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
