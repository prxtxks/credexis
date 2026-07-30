/**
 * Recompute orchestration (M7.7): load the deal's finalized inputs, run the
 * ONE engine (Iron Law #3), replace computed_metrics. Called after every
 * fact/addback/scenario mutation, always as the caller - RLS scopes every
 * read and write, and the engine runs in-process (exit-gate budget: the
 * whole round trip stays well under 2s).
 *
 * This module does I/O and reshaping ONLY - zero arithmetic. All math is
 * in @credexis/engine (the client-math CI grep enforces the same for the
 * rest of apps/web).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cents } from "@credexis/shared";
import {
  computeMetrics,
  ENGINE_VERSION,
  runGates,
  DEFAULT_GATE_CONFIG,
  type EngineAddback,
  type EngineFact,
  type GateFact,
} from "@credexis/engine";
import { TAXONOMY_V1 } from "@credexis/schema";
import { registryGateSpecs } from "@credexis/extraction";
import { bigintFromDb } from "../addbacks/logic";
import { metricInsertRows, scenarioFromRow, type ScenarioRow } from "./logic";

export interface RecomputeResult {
  scenarios: { id: string | null; metrics: number }[];
  skipped: { id: string; reason: string }[];
  openIssues?: number;
}

export async function recomputeDeal(
  supabase: SupabaseClient,
  tenantId: string,
  dealId: string,
): Promise<RecomputeResult> {
  const [factsRes, addbacksRes, scenariosRes, periodsRes] = await Promise.all([
    supabase
      .from("facts")
      .select(
        "id, entity_id, taxonomy_node_key, registry_field_id, value_cents, method, status, source_logical_document_id, periods(label)",
      )
      .eq("deal_id", dealId)
      .in("status", ["accepted", "suggested"]), // engine uses accepted; gates see both
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

  // ── Gates after every recompute (M6.1: "after every pipeline run and
  // every override") → the issues panel (M8.5). Sync = resolve all open,
  // insert the fresh violations; append-mostly, no deletes.
  const gateFacts: GateFact[] = (factsRes.data ?? []).map((f) => ({
    id: f.id as string,
    entityId: f.entity_id as string,
    periodLabel: (f.periods as unknown as { label: string } | null)?.label ?? "(unknown period)",
    taxonomyNodeKey: (f.taxonomy_node_key as string | null) ?? null,
    registryFieldId: (f.registry_field_id as string | null) ?? null,
    valueCents: bigintFromDb(f.value_cents as number),
    method: f.method as GateFact["method"],
    status: f.status as GateFact["status"],
    logicalDocumentId: (f.source_logical_document_id as string | null) ?? null,
  }));
  // Registry relations/flows as G4 data (M4.1 → M6.1): with registry-only
  // facts landing (AGI, taxable income), the derived-line arithmetic and
  // cross-form flows are finally checkable deal-wide.
  const { relations: registryRelations, flows: registryFlows } = registryGateSpecs();
  const gateRun = runGates(gateFacts, {
    ...DEFAULT_GATE_CONFIG,
    taxonomy: TAXONOMY_V1.map((n) => ({ key: n.key, parentKey: n.parentKey })),
    registryRelations,
    registryFlows,
  });

  const { error: resolveErr } = await supabase
    .from("issues")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("deal_id", dealId)
    .eq("status", "open");
  if (resolveErr) throw new Error(`issues resolve: ${resolveErr.message}`);

  if (gateRun.issues.length > 0) {
    const { error: issueErr } = await supabase.from("issues").insert(
      gateRun.issues.map((i) => ({
        tenant_id: tenantId,
        deal_id: dealId,
        gate: i.gate,
        severity: i.severity,
        fact_ids: i.implicatedFactIds,
        message: i.message,
        status: "open",
      })),
    );
    if (issueErr) throw new Error(`issues insert: ${issueErr.message}`);
  }
  result.openIssues = gateRun.issues.length;
  return result;
}
