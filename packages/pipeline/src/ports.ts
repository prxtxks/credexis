/**
 * Narrow ports the ingest orchestration depends on. The Trigger.dev task
 * binds these to Supabase (service-role, worker-side); tests bind them to
 * in-memory fakes. Keeping the surface this small is what makes the
 * orchestration unit-testable without a database or a queue.
 */

import type { FormFamily } from "@credexis/schema";

export type VirusScanStatus = "pending" | "clean" | "infected" | "failed";
export type DocumentStatus = "uploaded" | "processing" | "processed" | "failed";
export type RunStatus = "running" | "succeeded" | "failed";

export interface DocumentRow {
  id: string;
  tenantId: string;
  dealId: string;
  fileName: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  /**
   * Set when the bytes arrived through the borrower portal. The worker MUST
   * read it: without it, a borrower-originated row is indistinguishable from
   * a staff one and the path assertion below has nothing to pin against.
   */
  uploadedViaInviteId: string | null;
}

export interface LogicalDocumentInsert {
  tenantId: string;
  documentId: string;
  formFamily: FormFamily | "UNKNOWN";
  taxYear: number | null;
  pageStart: number;
  pageEnd: number;
}

export interface ExtractionRunInsert {
  tenantId: string;
  dealId: string;
  documentId: string;
  stage:
    | "ingest"
    | "split_classify"
    | "extract_path1"
    | "extract_path2"
    | "extract_consensus"
    | "extract_statement";
  extractorName: string;
  extractorVersion: string;
  model: string | null;
  pageCount: number | null;
  costMicroUsd: bigint;
  status: RunStatus;
  error: string | null;
  metadata: Record<string, unknown> | null;
  durationMs: number;
}

export interface DbPort {
  getDocument(documentId: string): Promise<DocumentRow | null>;
  setDocumentStatus(documentId: string, status: DocumentStatus): Promise<void>;
  setVirusScan(documentId: string, status: VirusScanStatus): Promise<void>;
  /** Returns the new logical_documents id. */
  insertLogicalDocument(row: LogicalDocumentInsert): Promise<string>;
  insertPages(
    rows: { tenantId: string; logicalDocumentId: string; pageNumber: number }[],
  ): Promise<void>;
  insertExtractionRun(row: ExtractionRunInsert): Promise<void>;
}

export interface StoragePort {
  download(storagePath: string): Promise<Uint8Array>;
}

export interface ScanResult {
  status: Exclude<VirusScanStatus, "pending">;
  engine: string;
  /** Signature / error detail; never file contents. */
  detail?: string;
}

/**
 * Virus-scan seam. Wired to StructuralScanner (scan/structural.ts) since
 * M12.1 - deterministic magic-byte + PDF active-content validation, the
 * engine recorded with every verdict. A signature engine (ClamAV sidecar)
 * can replace it behind this same port. `mimeType` is the DECLARED type
 * from the documents row - the scanner's job includes proving the bytes
 * match it.
 */
export interface VirusScanner {
  scan(bytes: Uint8Array, mimeType: string): Promise<ScanResult>;
}
