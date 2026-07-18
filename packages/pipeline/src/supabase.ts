/**
 * Supabase bindings for the ports — WORKER-SIDE ONLY. This runs inside
 * Trigger.dev tasks, which is a background context, not a request path:
 * the service-role key is legal here (Iron Law #7 forbids it in request
 * paths). Every write still stamps tenant_id, and the payload/document
 * tenant match is enforced in runIngest before any write happens.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  DbPort,
  DocumentRow,
  DocumentStatus,
  ExtractionRunInsert,
  LogicalDocumentInsert,
  StoragePort,
  VirusScanStatus,
} from "./ports.js";

const DEAL_DOCUMENTS_BUCKET = "deal-documents";

export function serviceClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("pipeline: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function supabaseDb(client: SupabaseClient): DbPort {
  return {
    async getDocument(documentId: string): Promise<DocumentRow | null> {
      const { data, error } = await client
        .from("documents")
        .select("id, tenant_id, deal_id, file_name, storage_path, sha256, bytes, mime_type")
        .eq("id", documentId)
        .maybeSingle();
      if (error) throw new Error(`documents select: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id as string,
        tenantId: data.tenant_id as string,
        dealId: data.deal_id as string,
        fileName: data.file_name as string,
        storagePath: data.storage_path as string,
        sha256: data.sha256 as string,
        bytes: data.bytes as number,
        mimeType: data.mime_type as string,
      };
    },

    async setDocumentStatus(documentId: string, status: DocumentStatus): Promise<void> {
      const { error } = await client.from("documents").update({ status }).eq("id", documentId);
      if (error) throw new Error(`documents status update: ${error.message}`);
    },

    async setVirusScan(documentId: string, status: VirusScanStatus): Promise<void> {
      const { error } = await client
        .from("documents")
        .update({ virus_scan: status })
        .eq("id", documentId);
      if (error) throw new Error(`documents virus_scan update: ${error.message}`);
    },

    async insertLogicalDocument(row: LogicalDocumentInsert): Promise<string> {
      const { data, error } = await client
        .from("logical_documents")
        .insert({
          tenant_id: row.tenantId,
          document_id: row.documentId,
          form_family: row.formFamily,
          tax_year: row.taxYear,
          page_start: row.pageStart,
          page_end: row.pageEnd,
        })
        .select("id")
        .single();
      if (error) throw new Error(`logical_documents insert: ${error.message}`);
      return data.id as string;
    },

    async insertPages(rows): Promise<void> {
      if (rows.length === 0) return;
      const { error } = await client.from("pages").insert(
        rows.map((r) => ({
          tenant_id: r.tenantId,
          logical_document_id: r.logicalDocumentId,
          page_number: r.pageNumber,
        })),
      );
      if (error) throw new Error(`pages insert: ${error.message}`);
    },

    async insertExtractionRun(row: ExtractionRunInsert): Promise<void> {
      const finishedAt = new Date();
      const { error } = await client.from("extraction_runs").insert({
        tenant_id: row.tenantId,
        deal_id: row.dealId,
        document_id: row.documentId,
        stage: row.stage,
        extractor_name: row.extractorName,
        extractor_version: row.extractorVersion,
        model: row.model,
        page_count: row.pageCount,
        status: row.status,
        error: row.error,
        // bigint → string: exact over the wire, bigint in Postgres.
        cost_micro_usd: row.costMicroUsd.toString(),
        metadata: row.metadata,
        started_at: new Date(finishedAt.getTime() - row.durationMs).toISOString(),
        finished_at: finishedAt.toISOString(),
      });
      if (error) throw new Error(`extraction_runs insert: ${error.message}`);
    },
  };
}

export function supabaseStorage(client: SupabaseClient): StoragePort {
  return {
    async download(storagePath: string): Promise<Uint8Array> {
      const { data, error } = await client.storage
        .from(DEAL_DOCUMENTS_BUCKET)
        .download(storagePath);
      if (error || !data) throw new Error(`storage download: ${error?.message ?? "no data"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
