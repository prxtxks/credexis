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
import { createEmailSender, identityReviewEmail, resolveDealLimits } from "@credexis/shared";
import { StructuralScanner } from "../scan/structural.js";
import { runIngest, type IngestResult } from "../ingest.js";
import { logEvent, type LogContext } from "../log.js";
import { runExtractStage } from "../extract-stage.js";
import {
  serviceClient,
  supabaseDb,
  supabaseExtractDb,
  supabaseMappingsStore,
  supabaseStorage,
} from "../supabase.js";

/**
 * `document_failed` fan-out (M12.1). B4 posture: service-role writer with
 * EXPLICIT tenant scoping in code. Best-effort — a notification outage
 * must never fail the pipeline — but errors are surfaced, not swallowed:
 * supabase-js RETURNS errors rather than throwing, so the earlier
 * try/catch-only version logged nothing when the write failed (that is
 * exactly how the partial-index 42P10 bug stayed invisible; index fixed
 * in migration 0022).
 */
async function notifyDocumentFailed(
  client: ReturnType<typeof serviceClient>,
  log: LogContext,
  payload: { tenantId: string; dealId: string; documentId: string },
  reason: string,
): Promise<void> {
  try {
    const { data: recips, error: recipErr } = await client
      .from("profiles")
      .select("id")
      .eq("tenant_id", payload.tenantId)
      .eq("status", "active")
      .in("role", ["org_owner", "admin", "underwriter"]);
    if (recipErr) {
      logEvent(log, "notify-errored", { error: recipErr.message.slice(0, 200) });
      return;
    }
    if (!recips || recips.length === 0) return;
    const { error } = await client.from("notifications").upsert(
      recips.map((r) => ({
        tenant_id: payload.tenantId,
        recipient_id: r.id as string,
        kind: "document_failed",
        title: "Document failed processing",
        body: reason.slice(0, 140),
        action_url: `/deals/${payload.dealId}/documents`,
        deal_id: payload.dealId,
        state: "unread",
        dedupe_key: `doc_failed:${payload.documentId}`,
      })),
      { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true },
    );
    if (error) logEvent(log, "notify-errored", { error: error.message.slice(0, 200) });
  } catch (e) {
    logEvent(log, "notify-errored", { error: (e as Error).message.slice(0, 200) });
  }
}

/** The pipeline board's vocabulary, in funnel order (deal_status enum). */
const DEAL_STATUS_ORDER = ["intake", "parsing", "review", "complete"] as const;
type DealStatus = (typeof DEAL_STATUS_ORDER)[number];

/**
 * Deal pipeline status (m8-10) — the writer the board never had.
 *
 * MONOTONIC AND IDEMPOTENT BY CONSTRUCTION: the statement names every
 * status the deal may be coming FROM (strictly behind the target), so it
 * is a no-op unless the deal is genuinely earlier in the funnel. A retried
 * run, or a second document's run racing this one, therefore cannot drag a
 * deal in 'review' back to 'parsing' — Postgres re-evaluates that
 * predicate after the row lock is released, so the loser of a race matches
 * zero rows instead of overwriting the winner. Human hands may still move
 * a deal backwards (deals.setStatus); the worker never does.
 *
 * B4 posture, identical to the notification fan-out above: service-role
 * writer with EXPLICIT tenant scoping in code, because the worker bypasses
 * RLS. Best-effort — a board that lags must never fail an ingest — but
 * errors are logged, not swallowed (supabase-js RETURNS errors).
 */
async function advanceDealStatus(
  client: ReturnType<typeof serviceClient>,
  log: LogContext,
  payload: { tenantId: string; dealId: string },
  to: DealStatus,
): Promise<void> {
  const from = DEAL_STATUS_ORDER.slice(0, DEAL_STATUS_ORDER.indexOf(to));
  if (from.length === 0) return;
  try {
    const { data, error } = await client
      .from("deals")
      .update({ status: to, updated_at: new Date().toISOString() })
      .eq("id", payload.dealId)
      .eq("tenant_id", payload.tenantId)
      .in("status", from)
      .select("id");
    if (error) {
      logEvent(log, "deal-status-errored", { error: error.message.slice(0, 200) });
      return;
    }
    if ((data ?? []).length > 0) logEvent(log, "deal-status-advanced", { status: to });
  } catch (e) {
    logEvent(log, "deal-status-errored", { error: (e as Error).message.slice(0, 200) });
  }
}

/**
 * parsing → review, gated on the deal actually HAVING something to review.
 * The review queue is "suggested facts on this deal"
 * (apps/web/src/server/trpc/routers/review.ts), so that count — not
 * "extraction finished" — is the honest signal: consensus auto-accepts
 * high-confidence facts, and a deal that lands in Review with an empty
 * queue teaches underwriters to ignore the column. count+head is one round
 * trip and, unlike summing rows client-side, immune to PostgREST's
 * 1000-row page cap (the bug that once weakened the cost ceiling).
 */
async function advanceIfReviewable(
  client: ReturnType<typeof serviceClient>,
  log: LogContext,
  payload: { tenantId: string; dealId: string },
): Promise<void> {
  try {
    const { count, error } = await client
      .from("facts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", payload.tenantId)
      .eq("deal_id", payload.dealId)
      .eq("status", "suggested");
    if (error) {
      logEvent(log, "deal-status-errored", { error: error.message.slice(0, 200) });
      return;
    }
    if ((count ?? 0) > 0) await advanceDealStatus(client, log, payload, "review");
  } catch (e) {
    logEvent(log, "deal-status-errored", { error: (e as Error).message.slice(0, 200) });
  }
}

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

    // intake → parsing. The upload route commits the documents row before
    // it triggers this task, so reaching here IS "a document arrived" —
    // no separate count needed. Deliberately ahead of the cost ceiling and
    // the AV gate: a deal whose first document is withheld or infected
    // must still leave Intake, or the board hides the one deal that needs
    // a human most. Terminal state for that document is its own column.
    await advanceDealStatus(client, log, payload, "parsing");

    const anthropicKey = process.env["ANTHROPIC_API_KEY"];
    const llmUsage: { model: string; inputTokens: number; outputTokens: number }[] = [];

    // No key → deterministic-only classification; unresolved pages land in
    // the review queue instead of being guessed (Iron Law #1).
    const classifier = anthropicKey
      ? new AnthropicPageClassifier({ apiKey: anthropicKey, onUsage: (u) => llmUsage.push(u) })
      : null;

    try {
      // ── M12.1 cost ceiling — FIRST, before any LLM touches this file. ──
      // Page classification inside runIngest calls Anthropic per page, so
      // checking after ingest (as the first cut did) still burned tokens on
      // every upload to an already-over-budget deal. Over the ceiling, the
      // document is failed without a single vendor call. The sum is a SQL
      // aggregate (definer): a client-side row sum silently stopped
      // counting past PostgREST's 1000-row cap — weakest on the biggest
      // deals, which is backwards for a ceiling.
      const { data: tenantRow } = await client
        .from("tenants")
        .select("settings")
        .eq("id", payload.tenantId)
        .single();
      const limits = resolveDealLimits(tenantRow?.settings);
      const { data: spendRaw, error: spendErr } = await client.rpc("deal_extraction_spend", {
        p_deal: payload.dealId,
      });
      // A failed spend query must not silently disable the ceiling.
      if (spendErr) throw new Error(`cost ceiling unavailable: ${spendErr.message}`);
      const spent = BigInt(String(spendRaw ?? 0));
      if (spent >= limits.maxCostMicroUsdPerDeal) {
        const reason = `deal spend ${spent.toString()}µ$ ≥ ceiling ${limits.maxCostMicroUsdPerDeal.toString()}µ$`;
        logEvent(log, "cost-ceiling-blocked", { reason });
        await client.from("documents").update({ status: "failed" }).eq("id", payload.documentId);
        await client.from("extraction_runs").insert({
          tenant_id: payload.tenantId,
          deal_id: payload.dealId,
          document_id: payload.documentId,
          stage: "ingest",
          extractor_name: "cost-ceiling",
          extractor_version: "m12-1",
          status: "failed",
          error: `processing withheld: ${reason}`,
          cost_micro_usd: "0",
          finished_at: new Date().toISOString(),
        });
        await notifyDocumentFailed(client, log, payload, reason);
        return {
          documentId: payload.documentId,
          status: "failed",
          // Nothing was downloaded or scanned — the column keeps its
          // honest default rather than implying a verdict we never made.
          virusScan: "pending",
          logicalDocuments: [],
          reason,
        } satisfies IngestResult;
      }

      const result = await runIngest(
        {
          db: supabaseDb(client),
          storage: supabaseStorage(client),
          // M12.1: structural validation is the wired engine — magic bytes
          // must match the declared type, PDFs must carry no active
          // content (object streams inflated, hex escapes normalized).
          // Non-clean verdicts fail the document before any vendor call.
          scanner: new StructuralScanner(),
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
      if (result.status === "failed") {
        Sentry.captureMessage(`ingest failed: ${result.reason}`);
        // A failed document (integrity, AV verdict, corrupt PDF) gets a
        // card — underwriters must see it without opening the deal.
        await notifyDocumentFailed(client, log, payload, result.reason ?? "processing failed");
      }

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
            .select("storage_path, mime_type, virus_scan")
            .eq("id", payload.documentId)
            .eq("tenant_id", payload.tenantId)
            .single();

          // M12.1 AV lock #2: extraction ships bytes to vendors and spends
          // money, so it demands an explicit "clean" verdict on the ROW —
          // independent of the ingest-stage throw path, so a future caller
          // that reaches extraction another way still cannot skip it.
          // (The cost ceiling is checked at task entry, before any LLM.)
          let extractionBlocked: string | null = null;
          if (doc && (doc.virus_scan as string) !== "clean") {
            extractionBlocked = `av verdict "${(doc.virus_scan as string) ?? "unknown"}" — extraction requires clean`;
            // Withheld work must never look like completed work.
            await client.from("extraction_runs").insert({
              tenant_id: payload.tenantId,
              deal_id: payload.dealId,
              document_id: payload.documentId,
              stage: "extract_consensus",
              extractor_name: "av-gate",
              extractor_version: "m12-1",
              status: "failed",
              error: `extraction withheld: ${extractionBlocked}`,
              cost_micro_usd: "0",
              finished_at: new Date().toISOString(),
            });
          }

          if (extractionBlocked) {
            logEvent(log, "extract-blocked", { reason: extractionBlocked.slice(0, 200) });
          } else if (doc && (doc.mime_type as string) === "application/pdf") {
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
                .select("id, role, status, email, email_notifications")
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
                // M11.7: approval-class events also go out by email,
                // immediately, to opted-in recipients. Env-gated no-op
                // until RESEND_API_KEY exists; advisory like the cards.
                const sender = createEmailSender({
                  apiKey: process.env["RESEND_API_KEY"],
                  from: process.env["EMAIL_FROM"] ?? "Credexis <notifications@credexis.co>",
                });
                const baseUrl = (
                  process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000"
                ).replace(/\/$/, "");
                let dealName = "a deal";
                if (sender.enabled && (idents ?? []).length > 0) {
                  const { data: deal } = await client
                    .from("deals")
                    .select("name")
                    .eq("id", payload.dealId)
                    .single();
                  dealName = (deal?.name as string | undefined) ?? dealName;
                }
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
                  if (sender.enabled) {
                    const rendered = identityReviewEmail({
                      title,
                      extractedName: (ident.extracted_name as string).slice(0, 120),
                      dealName,
                      reviewUrl: `${baseUrl}/deals/${payload.dealId}/assignment`,
                    });
                    for (const r of recips) {
                      if (r.email_notifications !== true) continue;
                      const res = await sender.send({ to: r.email as string, ...rendered });
                      if (!res.sent) {
                        logEvent(log, "email-skipped", {
                          reason: res.reason?.slice(0, 120) ?? "unknown",
                        });
                      }
                    }
                  }
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

      // Outside the extract try on purpose: a partially-failed extraction
      // still leaves suggested facts behind, and those are exactly what a
      // human has to look at.
      await advanceIfReviewable(client, log, payload);
      return result;
    } catch (e) {
      logEvent(log, "errored", { error: (e as Error).message });
      Sentry.captureException(e);
      throw e; // Trigger.dev retry policy owns the retry
    }
  },
});
