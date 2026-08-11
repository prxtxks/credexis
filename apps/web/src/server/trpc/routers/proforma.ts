/**
 * Pro-forma API (M15): assumptions in, projection out. The projection is
 * COMPUTED server-side by the engine on every read - nothing stored but
 * the human's assumptions (Iron Law #3: the client renders, the engine
 * computes; Law #1: the assumption record is the lineage of every
 * projected number).
 *
 * The base anchors on ACCEPTED facts of the deal's target entity - the
 * same facts the metrics engine trusts. Suggested facts never steer a
 * projection a banker signs.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { computeDealProforma } from "../../proforma/compute";

const dealInput = z.object({
  dealId: z.string().uuid(),
  scenarioId: z.string().uuid().nullish(),
  /** Preview overrides - compute without saving (the UI's live editing). */
  preview: z
    .object({
      basePeriodLabel: z.string().optional(),
      monthsCovered: z.number().int().min(1).max(12).optional(),
      revenueGrowthBpsByYear: z
        .array(z.number().int().min(-5000).max(20000))
        .min(1)
        .max(5)
        .optional(),
      lineTreatments: z.record(z.string(), z.enum(["ratio", "fixed", "excluded"])).optional(),
      replacementSalaryCents: z.string().regex(/^\d+$/).optional(),
    })
    .optional(),
});

export const proformaRouter = router({
  get: protectedProcedure.input(dealInput).query(async ({ ctx, input }) => {
    try {
      return await computeDealProforma(ctx.supabase, {
        dealId: input.dealId,
        scenarioId: input.scenarioId ?? null,
        ...(input.preview ? { preview: input.preview } : {}),
      });
    } catch (e) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
    }
  }),

  save: underwriterProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        basePeriodLabel: z.string().min(1),
        monthsCovered: z.number().int().min(1).max(12),
        revenueGrowthBpsByYear: z.array(z.number().int().min(-5000).max(20000)).min(1).max(5),
        lineTreatments: z.record(z.string(), z.enum(["ratio", "fixed", "excluded"])),
        replacementSalaryCents: z.string().regex(/^\d+$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from("proforma_assumptions").upsert(
        {
          tenant_id: ctx.profile.tenantId,
          deal_id: input.dealId,
          base_period_label: input.basePeriodLabel,
          months_covered: input.monthsCovered,
          line_treatments: input.lineTreatments,
          revenue_growth_bps: input.revenueGrowthBpsByYear,
          year1_revenue_cents: null,
          replacement_salary_cents: input.replacementSalaryCents,
          updated_by: ctx.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { saved: true };
    }),
});
