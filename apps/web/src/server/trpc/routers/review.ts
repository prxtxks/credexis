/**
 * Review queue API (M6.3). Reads are RLS-scoped queries; mutations run as
 * the caller (underwriter+), so the M2.5 audit triggers record every
 * accept/correct with actor + before/after automatically. Corrections
 * supersede — they never mutate the original value (Iron Law #5).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { recomputeDeal } from "../../metrics/recompute";
import {
  buildSupersession,
  orderQueue,
  summarizeProgress,
  type ProgressCounts,
  type QueueFact,
  type QueueIssueRef,
  type SupersedableFact,
} from "../../review/logic";

const dealId = z.object({ dealId: z.string().uuid() });

export const reviewRouter = router({
  /** The ordered queue for a deal: severity → document order. */
  queue: protectedProcedure.input(dealId).query(async ({ ctx, input }) => {
    const [factsRes, issuesRes] = await Promise.all([
      ctx.supabase
        .from("facts")
        .select(
          "id, logical_document_id:source_logical_document_id, source_page, created_at, value_cents, taxonomy_node_key, registry_field_id, method, confidence, period_id, source_bbox",
        )
        .eq("deal_id", input.dealId)
        .eq("status", "suggested"),
      ctx.supabase
        .from("issues")
        .select("severity, fact_ids")
        .eq("deal_id", input.dealId)
        .eq("status", "open"),
    ]);
    if (factsRes.error)
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: factsRes.error.message });
    if (issuesRes.error)
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: issuesRes.error.message });

    const facts = (factsRes.data ?? []).map((f) => ({
      id: f.id as string,
      logicalDocumentId: (f.logical_document_id as string | null) ?? null,
      sourcePage: (f.source_page as number | null) ?? null,
      createdAt: f.created_at as string,
      // Display payload (rendered verbatim — the client never computes).
      valueCents: String(f.value_cents),
      taxonomyNodeKey: (f.taxonomy_node_key as string | null) ?? null,
      registryFieldId: (f.registry_field_id as string | null) ?? null,
      method: f.method as string,
      confidence: (f.confidence as number | null) ?? null,
      periodId: f.period_id as string,
      sourceBbox: (f.source_bbox as { x: number; y: number; w: number; h: number } | null) ?? null,
    })) satisfies QueueFact[];
    const issues: QueueIssueRef[] = (issuesRes.data ?? []).map((i) => ({
      severity: i.severity as QueueIssueRef["severity"],
      factIds: (i.fact_ids as string[]) ?? [],
    }));
    return orderQueue(facts, issues);
  }),

  /** Accept a suggested fact as-is (audited by the DB trigger). */
  accept: underwriterProcedure
    .input(z.object({ factId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("facts")
        .update({ status: "accepted" })
        .eq("id", input.factId)
        .eq("status", "suggested") // optimistic guard: review-only transition
        .select("id, deal_id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "fact is not in review (already resolved or not visible)",
        });
      }
      // M7.7: a finalized fact changes the spread — recompute before returning.
      await recomputeDeal(ctx.supabase, ctx.profile.tenantId, data.deal_id as string);
      return { factId: data.id as string, status: "accepted" as const };
    }),

  /**
   * Correct a suggested fact: INSERT an override fact, mark the original
   * overridden + superseded_by. Compensated two-step (PostgREST has no tx):
   * if the conditional patch loses a race, the inserted override is removed.
   */
  correct: underwriterProcedure
    .input(
      z.object({
        factId: z.string().uuid(),
        correctedCents: z.string().regex(/^-?\d+$/, "integer cents as string"),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: oldFact, error: readErr } = await ctx.supabase
        .from("facts")
        .select(
          "id, tenant_id, deal_id, entity_id, period_id, taxonomy_node_key, registry_field_id, value_cents, status, source_logical_document_id, source_page, source_bbox",
        )
        .eq("id", input.factId)
        .maybeSingle();
      if (readErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: readErr.message });
      if (!oldFact) throw new TRPCError({ code: "NOT_FOUND", message: "fact not found" });

      let plan;
      try {
        plan = buildSupersession(
          oldFact as unknown as SupersedableFact,
          input.correctedCents,
          ctx.profile.id,
          input.note,
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }

      const { data: inserted, error: insErr } = await ctx.supabase
        .from("facts")
        .insert(plan.insert)
        .select("id")
        .single();
      if (insErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: insErr.message });

      const { data: patched, error: patchErr } = await ctx.supabase
        .from("facts")
        .update({ ...plan.patch, superseded_by: inserted.id as string })
        .eq("id", input.factId)
        .eq("status", "suggested") // lost race → compensate
        .select("id")
        .maybeSingle();

      if (patchErr || !patched) {
        await ctx.supabase
          .from("facts")
          .delete()
          .eq("id", inserted.id as string);
        throw new TRPCError({
          code: "CONFLICT",
          message: patchErr?.message ?? "fact was resolved by someone else — correction discarded",
        });
      }

      await recomputeDeal(ctx.supabase, ctx.profile.tenantId, oldFact.deal_id as string);
      return {
        supersededFactId: input.factId,
        overrideFactId: inserted.id as string,
        status: "overridden" as const,
      };
    }),

  /** Reject an illegible suggested fact (audited). */
  reject: underwriterProcedure
    .input(z.object({ factId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("facts")
        .update({ status: "rejected" })
        .eq("id", input.factId)
        .eq("status", "suggested")
        .select("id, deal_id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "CONFLICT", message: "fact is not in review" });
      await recomputeDeal(ctx.supabase, ctx.profile.tenantId, data.deal_id as string);
      return { factId: data.id as string, status: "rejected" as const };
    }),

  /** "14 of 22 fields need review" (queue progress bar). */
  progress: protectedProcedure.input(dealId).query(async ({ ctx, input }) => {
    const counts: ProgressCounts = { suggested: 0, accepted: 0, overridden: 0, rejected: 0 };
    const { data, error } = await ctx.supabase
      .from("facts")
      .select("status")
      .eq("deal_id", input.dealId);
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    for (const row of data ?? []) {
      const s = row.status as keyof ProgressCounts;
      if (s in counts) counts[s] += 1;
    }
    return summarizeProgress(counts);
  }),
});
