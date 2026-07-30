/**
 * Pipeline progress API (M8.8): per-document stage timeline from
 * extraction_runs — the honest replacement for V1's opaque spinner. Today
 * the UI polls this; when the Trigger.dev task is deployed
 * (TRIGGER_ACCESS_TOKEN, [PRATIK]) the same shape streams over Realtime.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";

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
