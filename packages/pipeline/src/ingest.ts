/**
 * Ingest orchestration (M3.1/M3.5): download → integrity check → virus scan
 * → split/classify → logical_documents + pages, with one extraction_run per
 * attempted stage (M3.2). Pure orchestration over the ports — the Trigger.dev
 * task in ./trigger is a thin binding, so this whole flow unit-tests without
 * a queue or a database.
 *
 * Failure posture: anything after the "processing" mark that goes wrong
 * lands the document in `failed` with the failing stage's run recording the
 * error — a document is never left stuck in `processing` by a handled error.
 */

import { sha256Hex } from "@credexis/shared";
import {
  classifyBundle,
  groupIntoLogicalDocuments,
  inheritBundleYear,
  type PageClassifier,
  type PageInput,
} from "@credexis/extraction";
import { extractPdfText, type PdfText } from "./pdf.js";
import { anthropicCostMicroUsd } from "./pricing.js";
import type { DbPort, StoragePort, VirusScanner, VirusScanStatus } from "./ports.js";

export const PIPELINE_VERSION = "0.1.0";

export interface IngestPayload {
  documentId: string;
  tenantId: string;
  dealId: string;
}

export interface IngestDeps {
  db: DbPort;
  storage: StoragePort;
  scanner: VirusScanner | null;
  classifier: PageClassifier | null;
  /** LLM usage drained after classification (wired to the classifier's onUsage). */
  takeLlmUsage?: () => { model: string; inputTokens: number; outputTokens: number }[];
  /** Injectable for tests; defaults to unpdf. */
  extractPdf?: (bytes: Uint8Array) => Promise<PdfText>;
  now?: () => number;
}

export interface IngestResult {
  documentId: string;
  status: "processed" | "failed";
  virusScan: VirusScanStatus;
  logicalDocuments: {
    id: string;
    formFamily: string;
    taxYear: number | null;
    pageStart: number;
    pageEnd: number;
  }[];
  reason?: string;
}

export async function runIngest(deps: IngestDeps, payload: IngestPayload): Promise<IngestResult> {
  const now = deps.now ?? Date.now;

  // Pre-"processing" problems throw: the task retries them, and a bad
  // payload must never flip some other tenant's document to failed.
  const doc = await deps.db.getDocument(payload.documentId);
  if (!doc) throw new Error(`ingest: document ${payload.documentId} not found`);
  if (doc.tenantId !== payload.tenantId || doc.dealId !== payload.dealId) {
    throw new Error("ingest: payload tenant/deal mismatch with document row");
  }

  await deps.db.setDocumentStatus(doc.id, "processing");

  let virusScan: VirusScanStatus = "pending";
  let stage: "ingest" | "split_classify" = "ingest";
  let stageStartedAt = now();

  try {
    const bytes = await deps.storage.download(doc.storagePath);

    // The bytes we process must be the bytes that were uploaded — lineage
    // starts here (Iron Law #5: every fact will trace back to this hash).
    const digest = await sha256Hex(bytes);
    if (digest !== doc.sha256) {
      throw new Error(
        `integrity: storage sha256 ${digest.slice(0, 12)}… != documents.sha256 ${doc.sha256.slice(0, 12)}…`,
      );
    }

    if (deps.scanner) {
      const scan = await deps.scanner.scan(bytes, doc.mimeType);
      virusScan = scan.status;
      await deps.db.setVirusScan(doc.id, scan.status);
      if (scan.status !== "clean") {
        throw new Error(
          `virus scan ${scan.status} (${scan.engine})${scan.detail ? `: ${scan.detail}` : ""}`,
        );
      }
    }
    // No scanner wired → virus_scan stays "pending" (the column tells the
    // truth; a stub must not stamp files "clean").

    await deps.db.insertExtractionRun({
      tenantId: doc.tenantId,
      dealId: doc.dealId,
      documentId: doc.id,
      stage: "ingest",
      extractorName: "pipeline-ingest",
      extractorVersion: PIPELINE_VERSION,
      model: null,
      pageCount: null,
      costMicroUsd: 0n,
      status: "succeeded",
      error: null,
      metadata: { virusScan, sha256Verified: true, bytes: doc.bytes },
      durationMs: now() - stageStartedAt,
    });

    stage = "split_classify";
    stageStartedAt = now();
    const logicalDocuments: IngestResult["logicalDocuments"] = [];

    if (doc.mimeType === "application/pdf") {
      const { pageCount, pageTexts } = await (deps.extractPdf ?? extractPdfText)(bytes);
      const pages: PageInput[] = pageTexts.map((text, i) => ({ page: i + 1, text }));
      const classifications = await classifyBundle(pages, deps.classifier);
      const spans = inheritBundleYear(await groupIntoLogicalDocuments(pages, classifications));

      for (const span of spans) {
        const id = await deps.db.insertLogicalDocument({
          tenantId: doc.tenantId,
          documentId: doc.id,
          formFamily: span.formFamily ?? "UNKNOWN",
          taxYear: span.taxYear,
          pageStart: span.pageStart,
          pageEnd: span.pageEnd,
        });
        await deps.db.insertPages(
          Array.from({ length: span.pageEnd - span.pageStart + 1 }, (_, i) => ({
            tenantId: doc.tenantId,
            logicalDocumentId: id,
            pageNumber: i + 1,
          })),
        );
        logicalDocuments.push({
          id,
          formFamily: span.formFamily ?? "UNKNOWN",
          taxYear: span.taxYear,
          pageStart: span.pageStart,
          pageEnd: span.pageEnd,
        });
      }

      const usage = deps.takeLlmUsage?.() ?? [];
      const cost = usage.reduce((acc, u) => acc + anthropicCostMicroUsd(u.model, u), 0n);
      const byMethod = { deterministic: 0, llm: 0, unresolved: 0 };
      for (const c of classifications) byMethod[c.method] += 1;

      await deps.db.insertExtractionRun({
        tenantId: doc.tenantId,
        dealId: doc.dealId,
        documentId: doc.id,
        stage: "split_classify",
        extractorName: "split-classify",
        extractorVersion: PIPELINE_VERSION,
        model: usage[0]?.model ?? null,
        pageCount,
        costMicroUsd: cost,
        status: "succeeded",
        error: null,
        metadata: {
          spans: spans.length,
          deterministicPages: byMethod.deterministic,
          llmPages: byMethod.llm,
          unresolvedPages: byMethod.unresolved,
          duplicateSpans: spans.filter((s) => s.duplicateOf !== null).length,
        },
        durationMs: now() - stageStartedAt,
      });
    } else {
      // Images / spreadsheets: no page-level split yet — one UNKNOWN logical
      // document that the assignment UI (M6.5) resolves. Statement parsing
      // for XLSX enters in M5 with real cell access; never guessed here.
      const id = await deps.db.insertLogicalDocument({
        tenantId: doc.tenantId,
        documentId: doc.id,
        formFamily: "UNKNOWN",
        taxYear: null,
        pageStart: 1,
        pageEnd: 1,
      });
      await deps.db.insertPages([{ tenantId: doc.tenantId, logicalDocumentId: id, pageNumber: 1 }]);
      logicalDocuments.push({ id, formFamily: "UNKNOWN", taxYear: null, pageStart: 1, pageEnd: 1 });

      await deps.db.insertExtractionRun({
        tenantId: doc.tenantId,
        dealId: doc.dealId,
        documentId: doc.id,
        stage: "split_classify",
        extractorName: "split-classify",
        extractorVersion: PIPELINE_VERSION,
        model: null,
        pageCount: 1,
        costMicroUsd: 0n,
        status: "succeeded",
        error: null,
        metadata: { nonPdf: true, mimeType: doc.mimeType },
        durationMs: now() - stageStartedAt,
      });
    }

    await deps.db.setDocumentStatus(doc.id, "processed");
    return { documentId: doc.id, status: "processed", virusScan, logicalDocuments };
  } catch (e) {
    const reason = (e as Error).message;
    await deps.db.setDocumentStatus(doc.id, "failed");
    await deps.db.insertExtractionRun({
      tenantId: doc.tenantId,
      dealId: doc.dealId,
      documentId: doc.id,
      stage,
      extractorName: stage === "ingest" ? "pipeline-ingest" : "split-classify",
      extractorVersion: PIPELINE_VERSION,
      model: null,
      pageCount: null,
      costMicroUsd: 0n,
      status: "failed",
      error: reason,
      metadata: null,
      durationMs: now() - stageStartedAt,
    });
    return { documentId: doc.id, status: "failed", virusScan, logicalDocuments: [], reason };
  }
}
