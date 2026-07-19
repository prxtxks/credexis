/**
 * Addback API (M7.3): ONE model (post-mortem trap 8) — rule suggestions and
 * human decisions live in the same `addbacks` table; the engine's DAG reads
 * accepted rows only. Mutations run as the caller so the M2.5 audit trigger
 * records every state change with its actor.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { suggestAddbacks, type EngineFact } from "@credexis/engine";
import { cents } from "@credexis/shared";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { bigintFromDb, newSuggestions } from "../../addbacks/logic";

const dealId = z.object({ dealId: z.string().uuid() });

export const addbacksRouter = router({
  /** Every addback on the deal, joined to its source fact for display. */
  list: protectedProcedure.input(dealId).query(async ({ ctx, input }) => {
    const { data, error } = await ctx.supabase
      .from("addbacks")
      .select(
        "id, fact_id, category, state, amount_cents, note, created_at, facts(taxonomy_node_key, entity_id, periods(label))",
      )
      .eq("deal_id", input.dealId)
      .order("created_at", { ascending: true });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    return (data ?? []).map((a) => {
      const f = a.facts as unknown as {
        taxonomy_node_key: string | null;
        entity_id: string;
        periods: { label: string } | null;
      } | null;
      return {
        id: a.id as string,
        factId: (a.fact_id as string | null) ?? null,
        category: a.category as string,
        state: a.state as string,
        // Integer cents as a string — the client renders, never computes.
        amountCents: String(a.amount_cents),
        note: (a.note as string | null) ?? null,
        taxonomyNodeKey: f?.taxonomy_node_key ?? null,
        entityId: f?.entity_id ?? null,
        periodLabel: f?.periods?.label ?? null,
      };
    });
  }),

  /**
   * Run the engine's suggestion rules over the deal's accepted facts and
   * persist NEW (factId, category) pairs as `suggested`. Existing pairs —
   * including rejected ones — are never re-created.
   */
  suggest: underwriterProcedure.input(dealId).mutation(async ({ ctx, input }) => {
    const [factsRes, existingRes] = await Promise.all([
      ctx.supabase
        .from("facts")
        .select("id, entity_id, taxonomy_node_key, value_cents, method, status, periods(label)")
        .eq("deal_id", input.dealId)
        .eq("status", "accepted"),
      ctx.supabase.from("addbacks").select("fact_id, category").eq("deal_id", input.dealId),
    ]);
    if (factsRes.error)
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: factsRes.error.message });
    if (existingRes.error)
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: existingRes.error.message });

    const engineFacts: EngineFact[] = (factsRes.data ?? []).map((f) => ({
      id: f.id as string,
      entityId: f.entity_id as string,
      periodLabel: (f.periods as unknown as { label: string } | null)?.label ?? "(unknown period)",
      taxonomyNodeKey: (f.taxonomy_node_key as string | null) ?? null,
      valueCents: cents(bigintFromDb(f.value_cents as number)),
      method: f.method as EngineFact["method"],
      status: f.status as EngineFact["status"],
    }));

    const fresh = newSuggestions(
      suggestAddbacks(engineFacts),
      (existingRes.data ?? []).map((e) => ({
        factId: (e.fact_id as string | null) ?? null,
        category: e.category as string,
      })),
    );

    if (fresh.length > 0) {
      const { error: insErr } = await ctx.supabase.from("addbacks").insert(
        fresh.map((s) => ({
          tenant_id: ctx.profile.tenantId,
          deal_id: input.dealId,
          fact_id: s.factId,
          category: s.category,
          state: "suggested",
          amount_cents: BigInt(s.amountCents).toString(),
          note: s.rationale,
        })),
      );
      if (insErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: insErr.message });
    }
    return { suggested: fresh.length };
  }),

  /** Decide an addback. Re-decisions are allowed; the audit log keeps history. */
  decide: underwriterProcedure
    .input(
      z.object({
        addbackId: z.string().uuid(),
        state: z.enum(["accepted", "rejected"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("addbacks")
        .update({ state: input.state, updated_at: new Date().toISOString() })
        .eq("id", input.addbackId)
        .select("id, state")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "addback not found" });
      return { addbackId: data.id as string, state: data.state as string };
    }),
});
