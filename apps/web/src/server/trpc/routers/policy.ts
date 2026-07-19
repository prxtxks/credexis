/**
 * Policy compliance API (M8.6): evaluate the deal's PINNED pack (Iron Law
 * #8 — deals keep the pack they were underwritten under) against a
 * scenario's engine output. The schema↔engine type bridge lives here:
 * policyPackRulesSchema-parsed data feeds evaluatePolicy directly.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cents, makeDecimal } from "@credexis/shared";
import { evaluatePolicy, type MetricValue, type PolicyPackInput } from "@credexis/engine";
import { policyPackRulesSchema } from "@credexis/schema";
import { protectedProcedure, router } from "../init";

export const policyRouter = router({
  forDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid(), scenarioId: z.string().uuid().nullish() }))
    .query(async ({ ctx, input }) => {
      const { data: deal, error: dealErr } = await ctx.supabase
        .from("deals")
        .select("id, type, policy_pack_id, policy_packs(version, rules)")
        .eq("id", input.dealId)
        .maybeSingle();
      if (dealErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: dealErr.message });
      if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "deal not found" });

      const packRow = deal.policy_packs as unknown as {
        version: string;
        rules: unknown;
      } | null;
      const parsed = policyPackRulesSchema.safeParse(packRow?.rules);
      if (!parsed.success) {
        return { available: false as const, reason: "policy pack rules failed validation" };
      }
      // Explicit map: zod's `T | undefined` optionals vs the engine's exact
      // optional properties — runtime-identical, spelled out for the compiler.
      const pack: PolicyPackInput = {
        sopReference: parsed.data.sopReference,
        reviewStatus: parsed.data.reviewStatus,
        reviewedBy: parsed.data.reviewedBy,
        rules: parsed.data.rules.map((r) => ({
          id: r.id,
          label: r.label,
          metric: r.metric,
          op: r.op,
          ...(r.ratio !== undefined ? { ratio: r.ratio } : {}),
          ...(r.bps !== undefined ? { bps: r.bps } : {}),
          ...(r.months !== undefined ? { months: r.months } : {}),
          ...(r.cents !== undefined ? { cents: r.cents } : {}),
          appliesWhen: {
            ...(r.appliesWhen.dealTypes ? { dealTypes: r.appliesWhen.dealTypes } : {}),
            ...(r.appliesWhen.loanAmountCentsLte
              ? { loanAmountCentsLte: r.appliesWhen.loanAmountCentsLte }
              : {}),
            ...(r.appliesWhen.loanAmountCentsGt
              ? { loanAmountCentsGt: r.appliesWhen.loanAmountCentsGt }
              : {}),
            ...(r.appliesWhen.useOfProceeds ? { useOfProceeds: r.appliesWhen.useOfProceeds } : {}),
          },
          sopCitation: r.sopCitation,
        })),
      };

      if (!input.scenarioId) {
        return { available: false as const, reason: "select a loan scenario to evaluate policy" };
      }

      const [scenarioRes, metricsRes] = await Promise.all([
        ctx.supabase
          .from("loan_scenarios")
          .select("id, amount_cents, structure")
          .eq("id", input.scenarioId)
          .maybeSingle(),
        ctx.supabase
          .from("computed_metrics")
          .select(
            "metric, entity_id, period_label, value_kind, value_cents, ratio_mantissa, ratio_scale",
          )
          .eq("deal_id", input.dealId)
          .eq("scenario_id", input.scenarioId),
      ]);
      if (scenarioRes.error || !scenarioRes.data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "scenario not found" });
      }
      if (metricsRes.error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: metricsRes.error.message });
      }

      // Basis period: the latest period that has a DSCR — the underwriting
      // basis (historical latest; projections join with the pro-forma tab).
      const rows = metricsRes.data ?? [];
      const basisPeriod =
        rows
          .filter((m) => m.metric === "dscr_business" && m.period_label !== null)
          .map((m) => m.period_label as string)
          .sort()
          .at(-1) ?? null;

      const metricValues: Record<string, MetricValue> = {};
      for (const m of rows) {
        const inBasis = m.period_label === null || m.period_label === basisPeriod;
        if (!inBasis || m.metric in metricValues === false) {
          if (!inBasis) continue;
        }
        if (m.value_kind === "cents" && m.value_cents !== null) {
          metricValues[m.metric as string] = {
            kind: "cents",
            cents: cents(BigInt(String(m.value_cents))),
          };
        } else if (m.ratio_mantissa !== null && m.ratio_scale !== null) {
          metricValues[m.metric as string] = {
            kind: "ratio",
            ratio: makeDecimal(BigInt(String(m.ratio_mantissa)), m.ratio_scale as number),
          };
        }
      }

      const structure = (scenarioRes.data.structure as Record<string, unknown> | null) ?? {};
      const useOfProceeds = Array.isArray(structure["useOfProceeds"])
        ? (structure["useOfProceeds"] as string[])
        : [];

      const evaluation = evaluatePolicy({
        pack,
        deal: {
          dealType: deal.type as string,
          useOfProceeds,
          loanAmountCents: cents(BigInt(String(scenarioRes.data.amount_cents))),
        },
        metrics: metricValues,
      });

      return {
        available: true as const,
        packVersion: packRow?.version ?? "unknown",
        basisPeriod,
        certifiable: evaluation.certifiable,
        overall: evaluation.overall,
        rules: evaluation.rules.map((r) => ({
          ruleId: r.ruleId,
          label: r.label,
          metric: r.metric,
          status: r.status,
          margin: r.margin
            ? { mantissa: r.margin.mantissa.toString(), scale: r.margin.scale }
            : null,
        })),
      };
    }),
});
