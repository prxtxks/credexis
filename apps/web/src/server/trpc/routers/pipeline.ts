/**
 * Pipeline progress API (M8.8): per-document stage timeline from
 * extraction_runs — the honest replacement for V1's opaque spinner. Today
 * the UI polls this; when the Trigger.dev task is deployed
 * (TRIGGER_ACCESS_TOKEN, [PRATIK]) the same shape streams over Realtime.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";

export const pipelineRouter = router({
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
