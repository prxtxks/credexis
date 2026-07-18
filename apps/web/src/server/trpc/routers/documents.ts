/**
 * Documents API (M3.1): list a deal's uploads with pipeline status.
 * Reads are RLS-scoped; the UI polls this for live-ish status until the
 * Trigger.dev Realtime wiring lands (M8.8).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";

export const documentsRouter = router({
  list: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("documents")
        .select("id, file_name, status, virus_scan, bytes, mime_type, sha256, created_at")
        .eq("deal_id", input.dealId)
        .order("created_at", { ascending: false });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? []).map((d) => ({
        id: d.id as string,
        fileName: d.file_name as string,
        status: d.status as string,
        virusScan: d.virus_scan as string,
        bytes: d.bytes as number,
        mimeType: d.mime_type as string,
        sha256Short: (d.sha256 as string).slice(0, 12),
        createdAt: d.created_at as string,
      }));
    }),
});
