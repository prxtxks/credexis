/**
 * Metrics + scenarios API (M7.7). The client reads rendered values (cents
 * and mantissas as strings) and NEVER computes — the CI client-math grep
 * enforces it. Every scenario mutation triggers a synchronous recompute so
 * what the UI invalidates into is always current engine output.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { recomputeDeal } from "../../metrics/recompute";

const dealId = z.object({ dealId: z.string().uuid() });

const rateSpecSchema = z.object({
  type: z.enum(["fixed", "prime_spread"]),
  bps: z.number().int().min(0).optional(),
  spread_bps: z.number().int().min(0).optional(),
});

/** Human-entered structure inputs (integer cents as strings; bps as ints). */
const structureSchema = z
  .object({
    primeBps: z.number().int().min(0).optional(),
    capBps: z.number().int().min(0).optional(),
    interestOnlyMonths: z.number().int().min(0).optional(),
    replacementSalaryCents: z.string().regex(/^\d+$/).optional(),
    equityInjectionCents: z.string().regex(/^\d+$/).optional(),
    totalProjectCostCents: z.string().regex(/^\d+$/).optional(),
    sbaGuarantyBps: z.number().int().min(0).max(10000).optional(),
    useOfProceeds: z.array(z.string()).optional(),
  })
  .strict();

export const metricsRouter = router({
  /** Engine output for a deal (optionally one scenario), rendered as strings. */
  forDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid(), scenarioId: z.string().uuid().nullish() }))
    .query(async ({ ctx, input }) => {
      let q = ctx.supabase
        .from("computed_metrics")
        .select(
          "id, metric, entity_id, period_id, period_label, value_kind, value_cents, ratio_mantissa, ratio_scale, engine_version, scenario_id, computed_at",
        )
        .eq("deal_id", input.dealId);
      q = input.scenarioId ? q.eq("scenario_id", input.scenarioId) : q.is("scenario_id", null);
      const { data, error } = await q;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? []).map((m) => ({
        id: m.id as string,
        metric: m.metric as string,
        entityId: (m.entity_id as string | null) ?? null,
        periodLabel: (m.period_label as string | null) ?? null,
        valueKind: m.value_kind as "cents" | "ratio",
        valueCents: m.value_cents === null ? null : String(m.value_cents),
        ratioMantissa: m.ratio_mantissa === null ? null : String(m.ratio_mantissa),
        ratioScale: (m.ratio_scale as number | null) ?? null,
        engineVersion: m.engine_version as string,
        computedAt: m.computed_at as string,
      }));
    }),

  /** Full deal recompute (also runs automatically after every mutation). */
  recompute: underwriterProcedure.input(dealId).mutation(async ({ ctx, input }) => {
    return recomputeDeal(ctx.supabase, ctx.profile.tenantId, input.dealId);
  }),

  scenarios: router({
    list: protectedProcedure.input(dealId).query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("loan_scenarios")
        .select("id, name, amount_cents, rate_spec, term_months, structure, updated_at")
        .eq("deal_id", input.dealId)
        .order("created_at", { ascending: true });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? []).map((s) => ({
        id: s.id as string,
        name: s.name as string,
        amountCents: String(s.amount_cents),
        rateSpec: s.rate_spec as { type: string; bps?: number; spread_bps?: number },
        termMonths: s.term_months as number,
        structure: (s.structure as Record<string, unknown> | null) ?? null,
        updatedAt: s.updated_at as string,
      }));
    }),

    create: underwriterProcedure
      .input(
        z.object({
          dealId: z.string().uuid(),
          name: z.string().min(1).max(120),
          amountCents: z.string().regex(/^\d+$/),
          rateSpec: rateSpecSchema,
          termMonths: z.number().int().min(1).max(360),
          structure: structureSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await ctx.supabase
          .from("loan_scenarios")
          .insert({
            tenant_id: ctx.profile.tenantId,
            deal_id: input.dealId,
            name: input.name,
            amount_cents: input.amountCents,
            rate_spec: input.rateSpec,
            term_months: input.termMonths,
            structure: input.structure ?? null,
            created_by: ctx.profile.id,
          })
          .select("id")
          .single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        const recompute = await recomputeDeal(ctx.supabase, ctx.profile.tenantId, input.dealId);
        return { scenarioId: data.id as string, recompute };
      }),

    update: underwriterProcedure
      .input(
        z.object({
          scenarioId: z.string().uuid(),
          name: z.string().min(1).max(120).optional(),
          amountCents: z.string().regex(/^\d+$/).optional(),
          rateSpec: rateSpecSchema.optional(),
          termMonths: z.number().int().min(1).max(360).optional(),
          structure: structureSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (input.name !== undefined) patch["name"] = input.name;
        if (input.amountCents !== undefined) patch["amount_cents"] = input.amountCents;
        if (input.rateSpec !== undefined) patch["rate_spec"] = input.rateSpec;
        if (input.termMonths !== undefined) patch["term_months"] = input.termMonths;
        if (input.structure !== undefined) patch["structure"] = input.structure;

        const { data, error } = await ctx.supabase
          .from("loan_scenarios")
          .update(patch)
          .eq("id", input.scenarioId)
          .select("id, deal_id")
          .maybeSingle();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "scenario not found" });
        const recompute = await recomputeDeal(
          ctx.supabase,
          ctx.profile.tenantId,
          data.deal_id as string,
        );
        return { scenarioId: data.id as string, recompute };
      }),
  }),
});
