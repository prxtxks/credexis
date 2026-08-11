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
import { TAXONOMY_V1 } from "@credexis/schema";
import {
  defaultTreatment,
  projectProforma,
  type LineTreatment,
  type ProformaBase,
  type ProformaLoan,
} from "@credexis/engine";
import { cents, sumCents, ZERO_CENTS, type Cents } from "@credexis/shared";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { scenarioFromRow, type ScenarioRow } from "../../metrics/logic";

const NODE_LABEL = new Map(TAXONOMY_V1.map((n) => [n.key, n.label]));

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

function bigintFromDb(v: unknown): bigint {
  if (typeof v === "string") return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  throw new Error(`unexpected cents value: ${String(v)}`);
}

export const proformaRouter = router({
  get: protectedProcedure.input(dealInput).query(async ({ ctx, input }) => {
    // ── The target entity anchors the projection ──
    const { data: ents, error: entErr } = await ctx.supabase
      .from("entities")
      .select("id, name, kind")
      .eq("deal_id", input.dealId);
    if (entErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: entErr.message });
    const target =
      (ents ?? []).find((e) => e.kind === "target") ??
      (ents ?? []).find((e) => e.kind === "applicant") ??
      (ents ?? [])[0];
    if (!target) {
      return { state: "no_entity" as const };
    }

    // ── Accepted facts of the target, grouped by period ──
    const { data: facts, error: fErr } = await ctx.supabase
      .from("facts")
      .select("taxonomy_node_key, value_cents, status, periods(label)")
      .eq("entity_id", target.id as string)
      .in("status", ["accepted", "overridden"]);
    if (fErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: fErr.message });

    const byPeriod = new Map<string, Map<string, Cents[]>>();
    for (const f of facts ?? []) {
      const label = (f.periods as unknown as { label: string } | null)?.label;
      const key = f.taxonomy_node_key as string | null;
      if (!label || !key || !key.startsWith("is.")) continue;
      const period = byPeriod.get(label) ?? new Map<string, Cents[]>();
      const list = period.get(key) ?? [];
      list.push(cents(bigintFromDb(f.value_cents)));
      period.set(key, list);
      byPeriod.set(label, period);
    }
    const periods = [...byPeriod.keys()].sort();
    if (periods.length === 0) {
      return { state: "no_accepted_facts" as const, entityName: target.name as string };
    }

    // ── Stored assumptions (or defaults), preview overrides on top ──
    const { data: stored, error: aErr } = await ctx.supabase
      .from("proforma_assumptions")
      .select("*")
      .eq("deal_id", input.dealId)
      .maybeSingle();
    if (aErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: aErr.message });

    const basePeriodLabel =
      input.preview?.basePeriodLabel ??
      (stored?.base_period_label as string | undefined) ??
      periods[periods.length - 1]!;
    const period = byPeriod.get(basePeriodLabel);
    if (!period) {
      return { state: "base_period_gone" as const, basePeriodLabel, periods };
    }
    const monthsCovered =
      input.preview?.monthsCovered ?? (stored?.months_covered as number | undefined) ?? 12;
    const growth = input.preview?.revenueGrowthBpsByYear ??
      (stored?.revenue_growth_bps as number[] | undefined) ?? [0, 0, 0];
    const storedTreatments =
      input.preview?.lineTreatments ??
      (stored?.line_treatments as Record<string, string> | undefined) ??
      {};
    const replacementSalaryCents = cents(
      BigInt(
        input.preview?.replacementSalaryCents ??
          String((stored?.replacement_salary_cents as unknown) ?? "0"),
      ),
    );

    // ── Assemble the base: revenue + every expense-side line ──
    const sumKey = (key: string): Cents => sumCents(period.get(key) ?? []);
    const revenue =
      period.has("is.revenue.total") && sumKey("is.revenue.total") !== 0n
        ? sumKey("is.revenue.total")
        : sumCents(
            [...period.keys()].filter((k) => k.startsWith("is.revenue.")).map((k) => sumKey(k)),
          );
    const EXPENSE_PREFIXES = ["is.opex.", "is.other."];
    const lines = [...period.keys()]
      .filter((k) => EXPENSE_PREFIXES.some((p) => k.startsWith(p)))
      // Subtotal nodes (is.opex.total, …) are AGGREGATES of their sibling
      // lines - projecting them alongside the components double-counts
      // opex and understates NOI. The projection owns its own totals.
      .filter((k) => !k.endsWith(".total"))
      .sort()
      .map((key) => {
        const treatment =
          (storedTreatments[key] as LineTreatment | undefined) ?? defaultTreatment(key);
        return {
          key,
          label: NODE_LABEL.get(key) ?? key,
          amountCents: sumKey(key),
          treatment,
        };
      })
      .filter((l) => l.amountCents !== ZERO_CENTS);

    const base: ProformaBase = {
      periodLabel: basePeriodLabel,
      monthsCovered,
      revenueCents: revenue,
      lines,
    };

    // ── Loan: the selected scenario, via the metrics mapping ──
    let loan: ProformaLoan | null = null;
    let loanScenarioName: string | null = null;
    if (input.scenarioId) {
      const { data: srow, error: sErr } = await ctx.supabase
        .from("loan_scenarios")
        .select("id, name, amount_cents, rate_spec, term_months, structure")
        .eq("id", input.scenarioId)
        .eq("deal_id", input.dealId)
        .maybeSingle();
      if (sErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: sErr.message });
      if (srow) {
        const mapped = scenarioFromRow(srow as unknown as ScenarioRow);
        if (mapped.ok) {
          loan = {
            amountCents: mapped.scenario.amountCents,
            termMonths: mapped.scenario.termMonths,
            rateSteps: mapped.scenario.rateSteps,
            ...(mapped.scenario.interestOnlyMonths !== undefined
              ? { interestOnlyMonths: mapped.scenario.interestOnlyMonths }
              : {}),
          };
          loanScenarioName = (srow.name as string | null) ?? null;
        }
      }
    }

    const projection = projectProforma(
      base,
      {
        revenueGrowthBpsByYear: growth,
        replacementSalaryCents,
      },
      loan,
    );

    return {
      state: "ready" as const,
      entityName: target.name as string,
      periods,
      assumptions: {
        basePeriodLabel,
        monthsCovered,
        revenueGrowthBpsByYear: growth,
        lineTreatments: Object.fromEntries(lines.map((l) => [l.key, l.treatment])),
        replacementSalaryCents: replacementSalaryCents.toString(),
        saved: stored !== null,
      },
      base,
      projection,
      loanScenarioName,
    };
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
