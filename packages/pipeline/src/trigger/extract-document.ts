/**
 * extract-document (M14.5): extraction for ONE logical document, enqueued
 * when an underwriter assigns it an entity in the assignment UI.
 *
 * Why this task exists: multi-entity deals deliberately skip extraction at
 * ingest ("no entity assigned - assign in M6.5 UI"), and the assignment
 * mutation used to update the row and stop. Nothing ever re-ran
 * extraction, so a multi-entity deal could never produce facts - the
 * Golden Deal full-package run is exactly this shape (target + two
 * guarantors + their entities).
 *
 * Payload is ONE span, not a document: concurrent assignments then touch
 * disjoint work, so no run can double-insert another span's facts. The
 * zero-facts guard makes repeat-assigns of the same span no-ops, and the
 * trigger call carries an idempotency key on (span, entity) besides.
 */

import { task } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/node";
import { z } from "zod";
import {
  AnthropicLabelClassifier,
  AnthropicVisionAdapter,
  ReductoAdapter,
} from "@credexis/extraction";
import { logEvent } from "../log.js";
import { runExtractStage } from "../extract-stage.js";
import {
  serviceClient,
  supabaseExtractDb,
  supabaseMappingsStore,
  supabaseStorage,
} from "../supabase.js";
import { advanceIfReviewable } from "./ingest-document.js";

const payloadSchema = z.object({
  tenantId: z.string().uuid(),
  dealId: z.string().uuid(),
  documentId: z.string().uuid(),
  logicalDocumentId: z.string().uuid(),
});

export const extractDocument = task({
  id: "extract-document",
  maxDuration: 600,
  retry: { maxAttempts: 2 },
  run: async (rawPayload: unknown, { ctx }) => {
    const payload = payloadSchema.parse(rawPayload);
    const log = {
      task: "extract-document",
      runId: ctx.run.id,
      documentId: payload.documentId,
      dealId: payload.dealId,
      logicalDocumentId: payload.logicalDocumentId,
    };
    logEvent(log, "started");
    const client = serviceClient();

    try {
      // ── Guards: the span is real, ours, entity-assigned, and unextracted ──
      const { data: ld, error: ldErr } = await client
        .from("logical_documents")
        .select("id, document_id, form_family, tax_year, page_start, page_end, entity_id")
        .eq("id", payload.logicalDocumentId)
        .eq("tenant_id", payload.tenantId)
        .maybeSingle();
      if (ldErr) throw new Error(`logical_documents select: ${ldErr.message}`);
      if (!ld || (ld.document_id as string) !== payload.documentId) {
        logEvent(log, "skipped", { reason: "span not found for this document/tenant" });
        return { facts: 0, skipped: "span not found" };
      }
      if (ld.entity_id === null) {
        logEvent(log, "skipped", { reason: "no entity assigned" });
        return { facts: 0, skipped: "no entity assigned" };
      }

      const { count: factCount, error: fErr } = await client
        .from("facts")
        .select("id", { count: "exact", head: true })
        .eq("source_logical_document_id", payload.logicalDocumentId);
      if (fErr) throw new Error(`facts count: ${fErr.message}`);
      if ((factCount ?? 0) > 0) {
        // Already extracted (repeat assign, or a race that lost) - facts
        // are append-mostly and a second run would duplicate them.
        logEvent(log, "skipped", { reason: `span already has ${factCount} facts` });
        return { facts: 0, skipped: "already extracted" };
      }

      const { data: doc, error: dErr } = await client
        .from("documents")
        .select("storage_path, mime_type, virus_scan")
        .eq("id", payload.documentId)
        .eq("tenant_id", payload.tenantId)
        .eq("deal_id", payload.dealId)
        .single();
      if (dErr) throw new Error(`documents select: ${dErr.message}`);

      // Same AV lock as the ingest path (M12.1): extraction ships bytes to
      // vendors; it demands an explicit clean verdict, and withheld work
      // must never look like completed work.
      if ((doc.virus_scan as string) !== "clean") {
        const reason = `av verdict "${(doc.virus_scan as string) ?? "unknown"}" - extraction requires clean`;
        await client.from("extraction_runs").insert({
          tenant_id: payload.tenantId,
          deal_id: payload.dealId,
          document_id: payload.documentId,
          stage: "extract_consensus",
          extractor_name: "av-gate",
          extractor_version: "m14-5",
          status: "failed",
          error: `extraction withheld: ${reason}`,
          cost_micro_usd: "0",
          finished_at: new Date().toISOString(),
        });
        logEvent(log, "extract-blocked", { reason });
        return { facts: 0, skipped: reason };
      }
      if ((doc.mime_type as string) !== "application/pdf") {
        logEvent(log, "skipped", { reason: "not a PDF" });
        return { facts: 0, skipped: "not a PDF" };
      }

      const anthropicKey = process.env["ANTHROPIC_API_KEY"];
      const reducto = process.env["REDUCTO_API_KEY"]
        ? new ReductoAdapter({ apiKey: process.env["REDUCTO_API_KEY"] })
        : null;
      const vision = anthropicKey ? new AnthropicVisionAdapter({ apiKey: anthropicKey }) : null;

      const bytes = await supabaseStorage(client).download(doc.storage_path as string);
      const extract = await runExtractStage(
        {
          db: supabaseExtractDb(client),
          // Adapter roster mirrors ingest-document (ADR-0002): Reducto is
          // Path 1, Claude vision is Path 2, Azure stays benched.
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
          logicalDocuments: [
            {
              id: ld.id as string,
              formFamily: ld.form_family as string,
              taxYear: (ld.tax_year as number | null) ?? null,
              pageStart: ld.page_start as number,
              pageEnd: ld.page_end as number,
              entityId: ld.entity_id as string,
            },
          ],
        },
      );
      logEvent(log, "extracted", {
        facts: extract.factsInserted,
        skipped: extract.perDocument.filter((d) => d.skipped).length,
      });

      // Reviewers already watch this deal - one card per re-extraction,
      // deduped per span (B4 posture: explicit tenant scoping, best-effort).
      try {
        if (extract.factsInserted > 0) {
          const { data: recips, error: rErr } = await client
            .from("profiles")
            .select("id")
            .eq("tenant_id", payload.tenantId)
            .eq("status", "active")
            .in("role", ["org_owner", "admin", "underwriter"]);
          if (rErr) {
            logEvent(log, "notify-errored", { error: rErr.message.slice(0, 200) });
          } else if (recips && recips.length > 0) {
            const { error: nErr } = await client.from("notifications").upsert(
              recips.map((r) => ({
                tenant_id: payload.tenantId,
                recipient_id: r.id as string,
                kind: "document_processed",
                title: `Assigned document extracted - ${extract.factsInserted} facts`,
                body: null,
                action_url: `/deals/${payload.dealId}/workspace`,
                deal_id: payload.dealId,
                state: "unread",
                dedupe_key: `span_extracted:${payload.logicalDocumentId}`,
              })),
              { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
            );
            if (nErr) logEvent(log, "notify-errored", { error: nErr.message.slice(0, 200) });
          }
        }
      } catch (e) {
        logEvent(log, "notify-errored", { error: (e as Error).message.slice(0, 200) });
      }

      await advanceIfReviewable(client, log, payload);
      return { facts: extract.factsInserted, skipped: null };
    } catch (e) {
      logEvent(log, "errored", { error: (e as Error).message.slice(0, 300) });
      Sentry.captureException(e);
      throw e; // Trigger.dev retry policy owns the retry
    }
  },
});
