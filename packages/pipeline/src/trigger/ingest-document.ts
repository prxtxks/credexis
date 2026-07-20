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
  AzureDocumentIntelligenceAdapter,
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
          const azure =
            process.env["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"] &&
            process.env["AZURE_DOCUMENT_INTELLIGENCE_KEY"]
              ? new AzureDocumentIntelligenceAdapter({
                  endpoint: process.env["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"],
                  apiKey: process.env["AZURE_DOCUMENT_INTELLIGENCE_KEY"],
                })
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
                // Blueprint routing: Azure prebuilt-tax for the 1040 family,
                // Reducto for business returns + statement layout. Bake-off
                // (M3.4) may reroute; the seam is this function.
                path1ForFamily: (family) =>
                  family.startsWith("1040") || family === "W2"
                    ? (azure ?? reducto)
                    : (reducto ?? azure),
                path2: vision,
                statementLayout: reducto ?? azure,
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
