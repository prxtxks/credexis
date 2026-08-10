/**
 * Supabase bindings for the ports - WORKER-SIDE ONLY. This runs inside
 * Trigger.dev tasks, which is a background context, not a request path:
 * the service-role key is legal here (Iron Law #7 forbids it in request
 * paths). Every write still stamps tenant_id, and the payload/document
 * tenant match is enforced in runIngest before any write happens.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LearnedMapping, LearnedMappingsStore } from "@credexis/extraction";
import type {
  DbPort,
  DocumentRow,
  DocumentStatus,
  ExtractionRunInsert,
  LogicalDocumentInsert,
  StoragePort,
  VirusScanStatus,
} from "./ports.js";
import type { ExtractDbPort, FactInsert } from "./extract-stage.js";

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
        .select(
          "id, tenant_id, deal_id, file_name, storage_path, sha256, bytes, mime_type, uploaded_via_invite_id",
        )
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
        uploadedViaInviteId: (data.uploaded_via_invite_id as string | null) ?? null,
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

/* ── extraction-stage ports (M4.5/M5.5) ─────────────────────────────── */

export function supabaseExtractDb(client: SupabaseClient): ExtractDbPort {
  return {
    async getDealEntities(dealId: string) {
      const { data, error } = await client
        .from("entities")
        .select("id, kind, name")
        .eq("deal_id", dealId);
      if (error) throw new Error(`entities select: ${error.message}`);
      return (data ?? []).map((e) => ({
        id: e.id as string,
        kind: e.kind as string,
        name: (e.name as string | null) ?? "",
      }));
    },

    async insertDocumentIdentity(row) {
      const { error } = await client.from("document_identities").insert(row);
      if (error) throw new Error(`document_identities insert: ${error.message}`);
    },

    async findOrCreatePeriod(row) {
      const { data: existing, error: selErr } = await client
        .from("periods")
        .select("id")
        .eq("entity_id", row.entityId)
        .eq("label", row.label)
        .maybeSingle();
      if (selErr) throw new Error(`periods select: ${selErr.message}`);
      if (existing) return existing.id as string;
      const { data, error } = await client
        .from("periods")
        .insert({
          tenant_id: row.tenantId,
          entity_id: row.entityId,
          kind: row.kind,
          label: row.label,
          start_date: row.startDate,
          end_date: row.endDate,
        })
        .select("id")
        .single();
      if (error) throw new Error(`periods insert: ${error.message}`);
      return data.id as string;
    },

    async insertFacts(rows: FactInsert[]) {
      if (rows.length === 0) return 0;
      const { error } = await client.from("facts").insert(rows);
      if (error) throw new Error(`facts insert: ${error.message}`);
      return rows.length;
    },

    async insertExtractionRun(row: ExtractionRunInsert) {
      return supabaseDb(client).insertExtractionRun(row);
    },
  };
}

/** Best mapping among candidates for one label: a human mapping always
 *  beats an LLM one, then the most-used wins. Exported for tests - this
 *  ranking is what keeps duplicated rows (migration 0035's subject) from
 *  failing reads. */
export function pickBestMapping(rows: readonly LearnedMapping[]): LearnedMapping | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort(
    (a, b) =>
      Number(b.source === "human") - Number(a.source === "human") || b.usageCount - a.usageCount,
  );
  return sorted[0] ?? null;
}

/** learned_mappings-backed store for the taxonomy mapper (M5.4). */
export function supabaseMappingsStore(client: SupabaseClient): LearnedMappingsStore {
  const toMapping = (r: Record<string, unknown>): LearnedMapping => ({
    labelNorm: r["label_norm"] as string,
    taxonomyNodeKey: r["taxonomy_node_key"] as string,
    confidence: r["confidence"] as number,
    source: (r["source"] as "human" | "llm") ?? "llm",
    usageCount: r["usage_count"] as number,
  });
  return {
    async findExact(tenantId, labelNorm) {
      let q = client.from("learned_mappings").select("*").eq("label_norm", labelNorm);
      q = tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", tenantId);
      // Tolerant of duplicates by construction: `.maybeSingle()` THROWS on
      // >1 row, and NULL-tenant rows historically duplicated (Postgres
      // UNIQUE treats NULLs as distinct - migration 0035). One duplicated
      // label must degrade to "best mapping wins", never fail the whole
      // statement extraction.
      const { data, error } = await q.limit(20);
      if (error) throw new Error(`learned_mappings select: ${error.message}`);
      return pickBestMapping((data ?? []).map(toMapping));
    },
    async listAll(tenantId) {
      let q = client.from("learned_mappings").select("*").limit(5000);
      q = tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw new Error(`learned_mappings list: ${error.message}`);
      return (data ?? []).map(toMapping);
    },
    async upsert(tenantId, mapping) {
      const existing = await this.findExact(tenantId, mapping.labelNorm);
      // A human mapping is never downgraded by an LLM write-back.
      if (existing?.source === "human" && mapping.source === "llm") return;
      const { error } = await client.from("learned_mappings").upsert(
        {
          tenant_id: tenantId,
          label_norm: mapping.labelNorm,
          taxonomy_node_key: mapping.taxonomyNodeKey,
          confidence: mapping.confidence,
          source: mapping.source,
          usage_count: (existing?.usageCount ?? 0) + 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,label_norm" },
      );
      if (error) throw new Error(`learned_mappings upsert: ${error.message}`);
    },
  };
}
