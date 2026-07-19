/**
 * Recompute orchestration (M7.7): load the deal's finalized inputs, run the
 * ONE engine (Iron Law #3), replace computed_metrics. Called after every
 * fact/addback/scenario mutation, always as the caller — RLS scopes every
 * read and write, and the engine runs in-process (exit-gate budget: the
 * whole round trip stays well under 2s).
 *
 * This module does I/O and reshaping ONLY — zero arithmetic. All math is
 * in @credexis/engine (the client-math CI grep enforces the same for the
 * rest of apps/web).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cents } from "@credexis/shared";
import {
  computeMetrics,
  ENGINE_VERSION,
  type EngineAddback,
  type EngineFact,
} from "@credexis/engine";
import { bigintFromDb } from "../addbacks/logic";
import { metricInsertRows, scenarioFromRow, type ScenarioRow } from "./logic";

export interface RecomputeResult {
  scenarios: { id: string | null; metrics: number }[];
  skipped: { id: string; reason: string }[];
}

export async function recomputeDeal(
  supabase: SupabaseClient,
  tenantId: string,
  dealId: string,
): Promise<RecomputeResult> {
  const [factsRes, addbacksRes, scenariosRes, periodsRes] = await Promise.all([
    supabase
      .from("facts")
      .select("id, entity_id, taxonomy_node_key, value_cents, method, status, periods(label)")
      .eq("deal_id", dealId)
      .eq("status", "accepted"),
    supabase
      .from("addbacks")
      .select("id, category, state, amount_cents, facts(entity_id, periods(label))")
      .eq("deal_id", dealId)
      .eq("state", "accepted"),
    supabase
      .from("loan_scenarios")
      .select("id, amount_cents, rate_spec, term_months, structure")
      .eq("deal_id", dealId),
    supabase
      .from("periods")
      .select("id, entity_id, label, entities!inner(deal_id)")
      .eq("entities.deal_id", dealId),
  ]);
  for (const r of [factsRes, addbacksRes, scenariosRes, periodsRes]) {
    if (r.error) throw new Error(`recompute load: ${r.error.message}`);
  }

  const facts: EngineFact[] = (factsRes.data ?? []).map((f) => ({
    id: f.id as string,
    entityId: f.entity_id as string,
    periodLabel: (f.periods as unknown as { label: string } | null)?.label ?? "(unknown period)",
    taxonomyNodeKey: (f.taxonomy_node_key as string | null) ?? null,
    valueCents: cents(bigintFromDb(f.value_cents as number)),
    method: f.method as EngineFact["method"],
    status: f.status as EngineFact["status"],
  }));

  // Addbacks place via their linked fact; manual rows without one cannot be
  // attributed to a cell yet and stay display-only until linked.
  const addbacks: EngineAddback[] = (addbacksRes.data ?? []).flatMap((a) => {
    const f = a.facts as unknown as {
      entity_id: string;
      periods: { label: string } | null;
    } | null;
    if (!f?.periods) return [];
    return [
      {
        id: a.id as string,
        entityId: f.entity_id,
        periodLabel: f.periods.label,
        category: a.category as EngineAddback["category"],
        state: a.state as EngineAddback["state"],
        amountCents: cents(bigintFromDb(a.amount_cents as number)),
      },
    ];
  });

  const periodIdByCell = new Map<string, string>(
    (periodsRes.data ?? []).map((p) => [
      `${p.entity_id as string}|${p.label as string}`,
      p.id as string,
    ]),
  );

  // One run per scenario, plus a scenario-less baseline for the spread.
  const mappings = [
    null,
    ...(scenariosRes.data ?? []).map((s) => scenarioFromRow(s as unknown as ScenarioRow)),
  ];

  const result: RecomputeResult = { scenarios: [], skipped: [] };
  for (const mapping of mappings) {
    if (mapping !== null && !mapping.ok) {
      result.skipped.push({ id: mapping.id, reason: mapping.reason });
      continue;
    }
    const scenarioId = mapping?.id ?? null;
    const engineResult = computeMetrics({
      facts,
      addbacks,
      scenario: mapping?.scenario ?? null,
    });
    const rows = metricInsertRows(engineResult.metrics, {
      tenantId,
      dealId,
      scenarioId,
      engineVersion: ENGINE_VERSION,
      periodIdByCell,
    });

    // Replace wholesale: derived data, engine-versioned, never mutated in place.
    const del = supabase.from("computed_metrics").delete().eq("deal_id", dealId);
    const { error: delErr } = await (scenarioId === null
      ? del.is("scenario_id", null)
      : del.eq("scenario_id", scenarioId));
    if (delErr) throw new Error(`recompute delete: ${delErr.message}`);

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("computed_metrics").insert(rows);
      if (insErr) throw new Error(`recompute insert: ${insErr.message}`);
    }
    result.scenarios.push({ id: scenarioId, metrics: rows.length });
  }
  return result;
}
