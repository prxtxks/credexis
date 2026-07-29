/**
 * Trigger.dev task `ingest-document` — the id the upload route's
 * trigger-client posts to (apps/web/src/server/pipeline/trigger-client.ts).
 * Thin binding only: all logic lives in runIngest, which is unit-tested
 * against fakes; this file just assembles real deps.
 */

import { task } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/node";
import { z } from "zod";
import {
  AnthropicLabelClassifier,
  AnthropicPageClassifier,
  AnthropicVisionAdapter,
  ReductoAdapter,
} from "@credexis/extraction";
import { runIngest, type IngestResult } from "../ingest.js";
import { logEvent } from "../log.js";
import { runExtractStage } from "../extract-stage.js";
import {
  serviceClient,
  supabaseDb,
  supabaseExtractDb,
  supabaseMappingsStore,
  supabaseStorage,
} from "../supabase.js";

const payloadSchema = z.object({
  documentId: z.string().uuid(),
  tenantId: z.string().uuid(),
  dealId: z.string().uuid(),
});

export const ingestDocument = task({
  id: "ingest-document",
  maxDuration: 600,
  retry: { maxAttempts: 3 },
  run: async (rawPayload: unknown, { ctx }): Promise<IngestResult> => {
    const payload = payloadSchema.parse(rawPayload);
    const log = {
      task: "ingest-document",
      runId: ctx.run.id,
      documentId: payload.documentId,
      dealId: payload.dealId,
    };
    logEvent(log, "started");

    const dsn = process.env["SENTRY_DSN"];
    if (dsn && !Sentry.isInitialized()) {
      Sentry.init({ dsn, environment: "pipeline", sendDefaultPii: false });
    }

    const client = serviceClient();
    const anthropicKey = process.env["ANTHROPIC_API_KEY"];
    const llmUsage: { model: string; inputTokens: number; outputTokens: number }[] = [];

    // No key → deterministic-only classification; unresolved pages land in
    // the review queue instead of being guessed (Iron Law #1).
    const classifier = anthropicKey
      ? new AnthropicPageClassifier({ apiKey: anthropicKey, onUsage: (u) => llmUsage.push(u) })
      : null;

    try {
      const result = await runIngest(
        {
          db: supabaseDb(client),
          storage: supabaseStorage(client),
          // Virus-scan engine not wired yet: virus_scan stays "pending"
          // (ports.ts documents the seam; stamping "clean" would be a lie).
          scanner: null,
          classifier,
          takeLlmUsage: () => llmUsage.splice(0),
        },
        payload,
      );
      logEvent(log, "finished", {
        status: result.status,
        logicalDocuments: result.logicalDocuments.length,
        virusScan: result.virusScan,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      if (result.status === "failed") Sentry.captureMessage(`ingest failed: ${result.reason}`);

      // ── Extraction stage (M4.5/M5.5): logical documents → facts. ──
      try {
        if (result.status === "processed" && result.logicalDocuments.length > 0) {
          const reducto = process.env["REDUCTO_API_KEY"]
            ? new ReductoAdapter({ apiKey: process.env["REDUCTO_API_KEY"] })
            : null;
          const vision = anthropicKey ? new AnthropicVisionAdapter({ apiKey: anthropicKey }) : null;

          // Fetch the persisted logical docs (entity assignments included).
          const { data: lds } = await client
            .from("logical_documents")
            .select("id, form_family, tax_year, page_start, page_end, entity_id")
            .eq("document_id", payload.documentId);
          const { data: doc } = await client
            .from("documents")
            .select("storage_path, mime_type")
            .eq("id", payload.documentId)
            .single();

          if (doc && (doc.mime_type as string) === "application/pdf") {
            const bytes = await supabaseStorage(client).download(doc.storage_path as string);
            const extract = await runExtractStage(
              {
                db: supabaseExtractDb(client),
                // ADR-0002 (bake-off, 2026-07-20): Reducto is Path 1 for
                // ALL families. Azure prebuilt-tax misread real CPA bundles
                // (hallucinated 1099s), so it is NOT a production fallback
                // (2026-07-24): a reader known to misread these documents
                // must never stand in for Reducto. If Reducto is
                // unavailable, Path 1 is null and reconciliation degrades to
                // the Claude-vision reader (path2) alone — a real, accurate
                // reader whose single-source values route to review — never
                // to a bad reader. Azure stays a bench-only eval contender;
                // re-promote only with data.
                path1ForFamily: () => reducto,
                path2: vision,
                statementLayout: reducto,
                labelClassifier: anthropicKey
                  ? new AnthropicLabelClassifier({ apiKey: anthropicKey })
                  : null,
                mappingsStore: supabaseMappingsStore(client),
              },
              {
                tenantId: payload.tenantId,
                dealId: payload.dealId,
                documentId: payload.documentId,
                bytes,
                mimeType: "application/pdf",
                logicalDocuments: (lds ?? []).map((ld) => ({
                  id: ld.id as string,
                  formFamily: ld.form_family as string,
                  taxYear: (ld.tax_year as number | null) ?? null,
                  pageStart: ld.page_start as number,
                  pageEnd: ld.page_end as number,
                  entityId: (ld.entity_id as string | null) ?? null,
                })),
              },
            );
            logEvent(log, "extracted", {
              facts: extract.factsInserted,
              documents: extract.perDocument.length,
              skipped: extract.perDocument.filter((d) => d.skipped).length,
            });

            // M11.5 notification fan-out (B4 honest posture: service-role
            // writer + EXPLICIT tenant scoping in code; recipients =
            // underwriter tier and above, active only — X3 fix).
            try {
              const { data: recips } = await client
                .from("profiles")
                .select("id, role, status")
                .eq("tenant_id", payload.tenantId)
                .eq("status", "active")
                .in("role", ["org_owner", "admin", "underwriter"]);
              if (recips && recips.length > 0) {
                await client.from("notifications").upsert(
                  recips.map((r) => ({
                    tenant_id: payload.tenantId,
                    recipient_id: r.id as string,
                    kind: "document_processed",
                    title: `Document processed — ${extract.factsInserted} facts extracted`,
                    body: null,
                    action_url: `/deals/${payload.dealId}/workspace`,
                    deal_id: payload.dealId,
                    state: "unread",
                    dedupe_key: `doc_processed:${payload.documentId}`,
                  })),
                  { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
                );
              }
              // M11.6: identity mismatches need a human — "Name matches
              // NN% — approve?" cards for every non-high suggested match
              // on this document (same recipients, same B4 posture).
              const ldIds = (lds ?? []).map((l) => l.id as string);
              if (ldIds.length > 0 && recips && recips.length > 0) {
                const { data: idents } = await client
                  .from("document_identities")
                  .select("id, logical_document_id, extracted_name, score_bps, band")
                  .in("logical_document_id", ldIds)
                  .eq("state", "suggested")
                  .neq("band", "high");
                for (const ident of idents ?? []) {
                  const pct = Math.round((ident.score_bps as number) / 100);
                  const title =
                    (ident.band as string) === "mid"
                      ? `Name matches ${pct}% — approve?`
                      : `Name mismatch on a document (${pct}%)`;
                  await client.from("notifications").upsert(
                    recips.map((r) => ({
                      tenant_id: payload.tenantId,
                      recipient_id: r.id as string,
                      kind: "identity_review",
                      title,
                      body: `Printed name: ${(ident.extracted_name as string).slice(0, 80)}`,
                      action_url: `/deals/${payload.dealId}/assignment`,
                      deal_id: payload.dealId,
                      state: "unread",
                      dedupe_key: `identity:${ident.id as string}`,
                    })),
                    { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
                  );
                }
              }
            } catch (e) {
              // Notifications are best-effort: never fail the pipeline.
              logEvent(log, "notify-errored", { error: (e as Error).message.slice(0, 200) });
            }
          }
        }
      } catch (e) {
        // Extraction failing must NOT retry the task: ingest already
        // committed logical documents and a re-run would duplicate them.
        // The document stays processed; facts can be re-extracted later.
        logEvent(log, "extract-errored", { error: (e as Error).message.slice(0, 300) });
        Sentry.captureException(e);
      }
      return result;
    } catch (e) {
      logEvent(log, "errored", { error: (e as Error).message });
      Sentry.captureException(e);
      throw e; // Trigger.dev retry policy owns the retry
    }
  },
});
