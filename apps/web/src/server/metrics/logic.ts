/**
 * Recompute mapping logic (M7.7): DB rows ⇄ engine shapes. Pure — no I/O,
 * no arithmetic (the engine computes; this file only reshapes). The
 * recompute orchestrator binds these to Supabase.
 */

import { cents, type Cents } from "@credexis/shared";
import {
  resolveRateBps,
  type ComputedMetric,
  type EngineScenario,
  type RateSpecInput,
} from "@credexis/engine";
import { bigintFromDb } from "../addbacks/logic";

export interface ScenarioRow {
  id: string;
  amount_cents: number | string;
  rate_spec: RateSpecInput;
  term_months: number;
  structure: Record<string, unknown> | null;
}

export type ScenarioMapping =
  | { ok: true; id: string; scenario: EngineScenario }
  | { ok: false; id: string; reason: string };

/**
 * A loan scenario row → engine scenario. Rate resolution inputs (current
 * prime, policy cap) live in the scenario's structure jsonb — explicit,
 * human-entered, versioned with the scenario (Iron Law #8: never a code
 * constant).
 */
export function scenarioFromRow(row: ScenarioRow): ScenarioMapping {
  const st = row.structure ?? {};
  const num = (k: string): number | undefined =>
    typeof st[k] === "number" ? (st[k] as number) : undefined;
  const centsOf = (k: string): Cents | undefined => {
    const v = st[k];
    if (typeof v === "string" && /^-?\d+$/.test(v)) return cents(BigInt(v));
    if (typeof v === "number" && Number.isSafeInteger(v)) return cents(BigInt(v));
    return undefined;
  };

  let annualRateBps: number;
  try {
    annualRateBps = resolveRateBps(row.rate_spec, {
      ...(num("primeBps") !== undefined ? { primeBps: num("primeBps")! } : {}),
      ...(num("capBps") !== undefined ? { capBps: num("capBps")! } : {}),
    });
  } catch (e) {
    return { ok: false, id: row.id, reason: (e as Error).message };
  }

  const interestOnly = num("interestOnlyMonths");
  const replacement = centsOf("replacementSalaryCents");
  const equity = centsOf("equityInjectionCents");
  const totalProject = centsOf("totalProjectCostCents");
  const guaranty = num("sbaGuarantyBps");

  return {
    ok: true,
    id: row.id,
    scenario: {
      amountCents: cents(bigintFromDb(row.amount_cents)),
      termMonths: row.term_months,
      rateSteps: [{ fromMonth: 1, annualRateBps }],
      ...(interestOnly !== undefined ? { interestOnlyMonths: interestOnly } : {}),
      ...(replacement !== undefined ? { replacementSalaryCents: replacement } : {}),
      ...(equity !== undefined || totalProject !== undefined || guaranty !== undefined
        ? {
            structure: {
              ...(equity !== undefined ? { equityInjectionCents: equity } : {}),
              ...(totalProject !== undefined ? { totalProjectCostCents: totalProject } : {}),
              ...(guaranty !== undefined ? { sbaGuarantyBps: guaranty } : {}),
            },
          }
        : {}),
    },
  };
}

export interface MetricInsertRow {
  tenant_id: string;
  deal_id: string;
  scenario_id: string | null;
  engine_version: string;
  metric: string;
  entity_id: string | null;
  period_id: string | null;
  period_label: string | null;
  value_kind: "cents" | "ratio";
  value_cents: string | null;
  ratio_mantissa: string | null;
  ratio_scale: number | null;
}

/** Engine metrics → computed_metrics insert rows (bigints as strings). */
export function metricInsertRows(
  metrics: ComputedMetric[],
  ctx: {
    tenantId: string;
    dealId: string;
    scenarioId: string | null;
    engineVersion: string;
    /** (entityId|periodLabel) → periods.id, for entity-scoped metrics. */
    periodIdByCell: Map<string, string>;
  },
): MetricInsertRow[] {
  return metrics.map((m) => ({
    tenant_id: ctx.tenantId,
    deal_id: ctx.dealId,
    scenario_id: ctx.scenarioId,
    engine_version: ctx.engineVersion,
    metric: m.metric,
    entity_id: m.entityId,
    period_id:
      m.entityId !== null && m.periodLabel !== null
        ? (ctx.periodIdByCell.get(`${m.entityId}|${m.periodLabel}`) ?? null)
        : null,
    period_label: m.periodLabel,
    value_kind: m.value.kind,
    value_cents: m.value.kind === "cents" ? BigInt(m.value.cents).toString() : null,
    ratio_mantissa: m.value.kind === "ratio" ? m.value.ratio.mantissa.toString() : null,
    ratio_scale: m.value.kind === "ratio" ? m.value.ratio.scale : null,
  }));
}
