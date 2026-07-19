/**
 * Deals API (M8.2 shell / M8.7 dashboard). RLS-scoped reads; the workspace
 * rail and pipeline board render from these.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";

export const dealsRouter = router({
  get: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("deals")
        .select("id, name, type, status, policy_pack_id, created_at")
        .eq("id", input.dealId)
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "deal not found" });
      return {
        id: data.id as string,
        name: data.name as string,
        type: data.type as string,
        status: data.status as string,
        policyPackId: data.policy_pack_id as string,
        createdAt: data.created_at as string,
      };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("deals")
      .select("id, name, type, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return (data ?? []).map((d) => ({
      id: d.id as string,
      name: d.name as string,
      type: d.type as string,
      status: d.status as string,
      createdAt: d.created_at as string,
    }));
  }),
});
