/**
 * Notification center (M11.5, design 02 §2). Reads and state changes are
 * self-scoped (RLS: own rows only) — safe for every role including
 * viewer. Rows are BORN elsewhere: DB triggers (member_joined) and the
 * pipeline's service-role writer (document events) — there is no
 * client-reachable insert (B1 fix).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("notifications")
        .select("id, kind, title, body, action_url, deal_id, state, created_at")
        .neq("state", "dismissed")
        .order("created_at", { ascending: false })
        .limit(input?.limit ?? 30);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? []).map((n) => ({
        id: n.id as string,
        kind: n.kind as string,
        title: n.title as string,
        body: (n.body as string | null) ?? null,
        actionUrl: (n.action_url as string | null) ?? null,
        dealId: (n.deal_id as string | null) ?? null,
        state: n.state as string,
        createdAt: n.created_at as string,
      }));
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const { count, error } = await ctx.supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("state", "unread");
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return { unread: count ?? 0 };
  }),

  setState: protectedProcedure
    .input(
      z.object({
        notificationId: z.string().uuid(),
        state: z.enum(["read", "actioned", "dismissed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("notifications")
        .update({ state: input.state })
        .eq("id", input.notificationId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "notification not found" });
      return { id: data.id as string, state: input.state };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const { error } = await ctx.supabase
      .from("notifications")
      .update({ state: "read" })
      .eq("state", "unread");
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return { ok: true };
  }),
});
