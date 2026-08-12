/**
 * Pipeline progress API (M8.8): per-document stage timeline from
 * extraction_runs - the honest replacement for V1's opaque spinner. Today
 * the UI polls this; when the Trigger.dev task is deployed
 * (TRIGGER_ACCESS_TOKEN, [PRATIK]) the same shape streams over Realtime.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { triggerReextract } from "../../pipeline/trigger-client";

/** Blueprint §12 per-deal COGS envelope: $10.00 = 10,000,000 micro-USD. */
const COST_ENVELOPE_MICRO_USD = 10_000_000n;

export const pipelineRouter = router({
  /**
   * Cost dashboard (M10.2): extraction spend per deal from extraction_runs.
   * Ops aggregation server-side (bigint, exact); the client renders strings.
   */
  costs: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("extraction_runs")
      .select("deal_id, stage, status, cost_micro_usd, page_count, deals(name)")
      .order("started_at", { ascending: false })
      .limit(5000);
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    interface DealCosts {
      dealId: string;
      dealName: string;
      runs: number;
      failedRuns: number;
      pages: number;
      totalMicroUsd: bigint;
      byStage: Map<string, bigint>;
    }
    const byDeal = new Map<string, DealCosts>();
    for (const r of data ?? []) {
      const id = r.deal_id as string;
      const entry = byDeal.get(id) ?? {
        dealId: id,
        dealName: (r.deals as unknown as { name: string } | null)?.name ?? "(deleted deal)",
        runs: 0,
        failedRuns: 0,
        pages: 0,
        totalMicroUsd: 0n,
        byStage: new Map<string, bigint>(),
      };
      const cost = BigInt(String(r.cost_micro_usd ?? 0));
      entry.runs += 1;
      if (r.status === "failed") entry.failedRuns += 1;
      entry.pages += (r.page_count as number | null) ?? 0;
      entry.totalMicroUsd += cost;
      entry.byStage.set(r.stage as string, (entry.byStage.get(r.stage as string) ?? 0n) + cost);
      byDeal.set(id, entry);
    }

    return [...byDeal.values()]
      .sort((a, b) => (a.totalMicroUsd > b.totalMicroUsd ? -1 : 1))
      .map((d) => ({
        dealId: d.dealId,
        dealName: d.dealName,
        runs: d.runs,
        failedRuns: d.failedRuns,
        pages: d.pages,
        totalMicroUsd: d.totalMicroUsd.toString(),
        envelopeMicroUsd: COST_ENVELOPE_MICRO_USD.toString(),
        overEnvelope: d.totalMicroUsd > COST_ENVELOPE_MICRO_USD,
        byStage: [...d.byStage.entries()].map(([stage, micro]) => ({
          stage,
          microUsd: micro.toString(),
        })),
      }));
  }),

  /**
   * Daily usage series, last 30 days (ui-19 Usage graphs): the SERVER
   * aggregates runs/pages/spend per day (Iron Law #3 - the client draws,
   * it never sums). Days with no runs are zero-filled so the chart's
   * x-axis is honest about quiet days.
   */
  usageSeries: protectedProcedure.query(async ({ ctx }) => {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const { data, error } = await ctx.supabase
      .from("extraction_runs")
      .select("started_at, page_count, cost_micro_usd, status")
      .gte("started_at", since.toISOString())
      .limit(5000);
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    const byDay = new Map<string, { runs: number; failed: number; pages: number; micro: bigint }>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(since.getTime() + i * 24 * 3600 * 1000);
      byDay.set(d.toISOString().slice(0, 10), { runs: 0, failed: 0, pages: 0, micro: 0n });
    }
    for (const r of data ?? []) {
      const key = String(r.started_at).slice(0, 10);
      const b = byDay.get(key);
      if (!b) continue;
      b.runs += 1;
      if (r.status === "failed") b.failed += 1;
      b.pages += (r.page_count as number | null) ?? 0;
      b.micro += BigInt(String(r.cost_micro_usd ?? 0));
    }
    return [...byDay.entries()].map(([date, b]) => ({
      date,
      runs: b.runs,
      failed: b.failed,
      pages: b.pages,
      microUsd: b.micro.toString(),
    }));
  }),

  /**
   * Org-wide run log (ui-18 /logs, 02-VERCEL-DERIVATION §4): newest-first
   * extraction runs with optional stage/status filters. RLS scopes to the
   * caller's tenant; read-only.
   */
  runs: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(100),
          stage: z.string().trim().min(1).max(40).optional(),
          status: z.enum(["running", "succeeded", "failed"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("extraction_runs")
        .select(
          "id, deal_id, stage, status, extractor_name, model, page_count, cost_micro_usd, error, started_at, finished_at, deals(name)",
        )
        .order("started_at", { ascending: false })
        .limit(input?.limit ?? 100);
      if (input?.stage) query = query.eq("stage", input.stage);
      if (input?.status) query = query.eq("status", input.status);
      const { data, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? []).map((r) => ({
        id: r.id as string,
        dealId: r.deal_id as string,
        dealName: (r.deals as unknown as { name: string } | null)?.name ?? "(deleted deal)",
        stage: r.stage as string,
        status: r.status as string,
        extractor: (r.extractor_name as string | null) ?? null,
        model: (r.model as string | null) ?? null,
        pages: (r.page_count as number | null) ?? null,
        costMicroUsd: String(r.cost_micro_usd ?? 0),
        error: (r.error as string | null) ?? null,
        startedAt: r.started_at as string,
        finishedAt: (r.finished_at as string | null) ?? null,
      }));
    }),

  /**
   * Re-run extraction for one document (M18.2): recovers documents whose
   * consensus failed transiently (the flagship's 7 vendor-401 casualties)
   * and spans whose only facts were repaired away. Safe to spam: the
   * extract-document task skips any span that already has facts.
   */
  reextract: underwriterProcedure
    .input(z.object({ dealId: z.string().uuid(), documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: spans, error } = await ctx.supabase
        .from("logical_documents")
        .select("id, form_family, documents!inner(deal_id)")
        .eq("document_id", input.documentId)
        .eq("documents.deal_id", input.dealId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!spans || spans.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "no spans for this document" });
      }
      let enqueued = 0;
      const reasons: string[] = [];
      for (const span of spans) {
        const r = await triggerReextract({
          tenantId: ctx.profile.tenantId,
          dealId: input.dealId,
          documentId: input.documentId,
          logicalDocumentId: span.id as string,
        });
        if (r.triggered) enqueued += 1;
        else if (r.reason) reasons.push(r.reason);
      }
      if (enqueued === 0) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: `extraction could not be enqueued: ${reasons[0] ?? "unknown"}`,
        });
      }
      return { enqueued, spans: spans.length };
    }),

  progress: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("extraction_runs")
        .select(
          "document_id, stage, status, error, extractor_name, model, page_count, started_at, finished_at",
        )
        .eq("deal_id", input.dealId)
        .order("started_at", { ascending: true });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      const byDocument = new Map<
        string,
        {
          stage: string;
          status: string;
          error: string | null;
          model: string | null;
          pageCount: number | null;
          startedAt: string;
          finishedAt: string | null;
        }[]
      >();
      for (const r of data ?? []) {
        const docId = (r.document_id as string | null) ?? "(deal)";
        const list = byDocument.get(docId) ?? [];
        list.push({
          stage: r.stage as string,
          status: r.status as string,
          error: (r.error as string | null) ?? null,
          model: (r.model as string | null) ?? null,
          pageCount: (r.page_count as number | null) ?? null,
          startedAt: r.started_at as string,
          finishedAt: (r.finished_at as string | null) ?? null,
        });
        byDocument.set(docId, list);
      }
      return Object.fromEntries(byDocument);
    }),
});
