/**
 * Issues API (M8.5): gate violations for the workspace panel, grouped by
 * severity client-side. Rows are produced by the recompute gate run —
 * this router only reads.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";

export const issuesRouter = router({
  forDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("issues")
        .select("id, gate, severity, fact_ids, message, status, created_at")
        .eq("deal_id", input.dealId)
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? []).map((i) => ({
        id: i.id as string,
        gate: i.gate as string,
        severity: i.severity as "info" | "warning" | "error" | "critical",
        factIds: (i.fact_ids as string[]) ?? [],
        message: i.message as string,
        createdAt: i.created_at as string,
      }));
    }),
});
