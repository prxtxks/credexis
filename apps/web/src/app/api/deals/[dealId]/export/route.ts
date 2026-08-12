/**
 * Banker workbook download (M10.1): GET → .xlsx. Runs AS THE CALLER -
 * RLS scopes every read; export is also an audit-worthy event and the
 * assembled data comes from the same sources the workspace renders.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assembleSpread, type SpreadFactRow, type TaxonomyNodeRow } from "@/server/spread/logic";
import { buildWorkbook, type ExportData, type ExportSpreadRow } from "@/server/export/workbook";
import { computeDealProforma } from "@/server/proforma/compute";
import { formatRatio } from "@/lib/money-display";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await context.params;
  const supabase = await createClient();
  let user = null;
  try {
    user = (await supabase.auth.getUser()).data.user;
  } catch {
    user = null;
  }
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const entityParam = url.searchParams.get("entity");
  const scenarioParam = url.searchParams.get("scenario");

  const [dealRes, entitiesRes] = await Promise.all([
    supabase.from("deals").select("id, name, policy_packs(version)").eq("id", dealId).maybeSingle(),
    supabase.from("entities").select("id, name").eq("deal_id", dealId).order("created_at"),
  ]);
  if (!dealRes.data) return NextResponse.json({ error: "deal not found" }, { status: 404 });
  const entity = entityParam
    ? (entitiesRes.data ?? []).find((e) => e.id === entityParam)
    : (entitiesRes.data ?? [])[0];
  if (!entity) return NextResponse.json({ error: "deal has no entities" }, { status: 400 });

  const [nodesRes, factsRes, metricsRes, addbacksRes, scenarioRes] = await Promise.all([
    supabase
      .from("taxonomy_nodes")
      .select("key, parent_key, label, sort_order, is_addback_relevant")
      .order("sort_order"),
    supabase
      .from("facts")
      .select(
        "id, taxonomy_node_key, value_cents, method, status, confidence, source_page, source_logical_document_id, periods(label)",
      )
      .eq("deal_id", dealId)
      .eq("entity_id", entity.id as string),
    supabase
      .from("computed_metrics")
      .select(
        "metric, entity_id, period_label, value_kind, value_cents, ratio_mantissa, ratio_scale, engine_version, scenario_id",
      )
      .eq("deal_id", dealId),
    supabase
      .from("addbacks")
      .select("category, state, amount_cents, note, facts(periods(label))")
      .eq("deal_id", dealId),
    scenarioParam
      ? supabase
          .from("loan_scenarios")
          .select("id, name, amount_cents, rate_spec, term_months")
          .eq("id", scenarioParam)
          .maybeSingle()
      : supabase
          .from("loan_scenarios")
          .select("id, name, amount_cents, rate_spec, term_months")
          .eq("deal_id", dealId)
          .order("created_at")
          .limit(1)
          .maybeSingle(),
  ]);

  const nodes: TaxonomyNodeRow[] = (nodesRes.data ?? []).map((n) => ({
    key: n.key as string,
    parentKey: (n.parent_key as string | null) ?? null,
    label: n.label as string,
    sortOrder: n.sort_order as number,
    isAddbackRelevant: n.is_addback_relevant as boolean,
  }));
  const facts: SpreadFactRow[] = (factsRes.data ?? []).map((f) => ({
    id: f.id as string,
    taxonomyNodeKey: (f.taxonomy_node_key as string | null) ?? null,
    periodLabel: (f.periods as unknown as { label: string } | null)?.label ?? "(unknown)",
    valueCents: String(f.value_cents),
    method: f.method as string,
    status: f.status as string,
    confidence: (f.confidence as number | null) ?? null,
    sourcePage: (f.source_page as number | null) ?? null,
    sourceLogicalDocumentId: (f.source_logical_document_id as string | null) ?? null,
  }));

  const scenarioId = (scenarioRes.data?.id as string | undefined) ?? null;
  const metricRows = (metricsRes.data ?? []).filter((m) =>
    scenarioId ? m.scenario_id === scenarioId || m.scenario_id === null : m.scenario_id === null,
  );
  const metricCells = (metrics: string[]): ExportSpreadRow[] =>
    metrics
      .map((metric) => {
        const cells: ExportSpreadRow["cells"] = {};
        for (const m of metricRows.filter((x) => x.metric === metric && x.period_label !== null)) {
          cells[m.period_label as string] =
            m.value_kind === "cents" && m.value_cents !== null
              ? { kind: "cents" as const, value: String(m.value_cents) }
              : {
                  kind: "ratio" as const,
                  value: formatRatio(String(m.ratio_mantissa), (m.ratio_scale as number) ?? 2),
                };
        }
        return { label: metric.replaceAll("_", " "), depth: 0, computed: true, cells };
      })
      .filter((r) => Object.keys(r.cells).length > 0);

  const spreadRows = (prefix: string, computedMetrics: string[]): ExportSpreadRow[] => {
    const filtered = nodes.filter((n) => n.key === prefix || n.key.startsWith(`${prefix}.`));
    const { rows } = assembleSpread(filtered, facts);
    const withFacts = new Set<string>();
    for (const r of rows) {
      if (Object.keys(r.cells).length === 0) continue;
      const parts = r.key.split(".");
      for (let i = 1; i <= parts.length; i++) withFacts.add(parts.slice(0, i).join("."));
    }
    const base: ExportSpreadRow[] = rows
      .filter((r) => withFacts.has(r.key))
      .map((r) => ({
        label: r.label,
        depth: r.depth,
        computed: false,
        cells: Object.fromEntries(
          Object.entries(r.cells).map(([p, c]) => [
            p,
            { kind: "cents" as const, value: c.valueCents },
          ]),
        ),
      }));
    return [...base, ...metricCells(computedMetrics)];
  };

  const periods = [...new Set(facts.map((f) => f.periodLabel))].sort();

  const cfads = metricRows
    .filter((m) => m.metric === "cfads" && m.period_label !== null)
    .sort((a, b) => String(a.period_label).localeCompare(String(b.period_label)))
    .at(-1);
  const ads = metricRows.find((m) => m.metric === "annual_debt_service");
  const dscr = metricRows
    .filter((m) => m.metric === "dscr_business" && m.period_label !== null)
    .sort((a, b) => String(a.period_label).localeCompare(String(b.period_label)))
    .at(-1);

  const rateSpec = scenarioRes.data?.rate_spec as {
    type?: string;
    bps?: number;
    spread_bps?: number;
  } | null;
  const data: ExportData = {
    dealName: dealRes.data.name as string,
    entityName: entity.name as string,
    engineVersion: (metricRows[0]?.engine_version as string | undefined) ?? "(no engine run)",
    policyPackVersion:
      (dealRes.data.policy_packs as unknown as { version: string } | null)?.version ?? "unknown",
    generatedAt: new Date().toISOString(),
    periods,
    incomeStatement: spreadRows("is", [
      "revenue_total",
      "gross_profit",
      "net_income",
      "ebitda",
      "sde",
      "cfads",
    ]),
    balanceSheet: spreadRows("bs", [
      "working_capital",
      "current_ratio",
      "tangible_net_worth",
      "debt_to_tnw",
    ]),
    globalCashFlow: spreadRows("pcf", ["personal_cash_flow", "global_cash_flow", "dscr_global"]),
    addbacks: (addbacksRes.data ?? []).map((a) => ({
      category: a.category as string,
      state: a.state as string,
      amountCents: String(a.amount_cents),
      note: (a.note as string | null) ?? null,
      periodLabel:
        (a.facts as unknown as { periods: { label: string } | null } | null)?.periods?.label ??
        null,
    })),
    scenario: scenarioRes.data
      ? {
          name: scenarioRes.data.name as string,
          amountCents: String(scenarioRes.data.amount_cents),
          termMonths: scenarioRes.data.term_months as number,
          rateDescription:
            rateSpec?.type === "fixed"
              ? `fixed ${rateSpec.bps ?? "?"} bps`
              : `prime + ${rateSpec?.spread_bps ?? "?"} bps`,
          annualDebtServiceCents: ads?.value_cents !== null && ads ? String(ads.value_cents) : null,
          cfadsCents: cfads?.value_cents !== null && cfads ? String(cfads.value_cents) : null,
          dscrDisplay:
            dscr && dscr.ratio_mantissa !== null
              ? formatRatio(String(dscr.ratio_mantissa), (dscr.ratio_scale as number) ?? 2)
              : null,
        }
      : null,
  };
  // M17: the org's export branding rides every workbook.
  const { data: brand } = await supabase
    .from("org_branding")
    .select("display_name, primary_color, accent_color, footer_text")
    .maybeSingle();
  if (brand) {
    data.branding = {
      displayName: (brand.display_name as string) ?? "",
      primaryColor: (brand.primary_color as string) ?? "#0D7A5F",
      accentColor: (brand.accent_color as string) ?? "#134E3A",
      footerText: (brand.footer_text as string) ?? "",
    };
  }
  // M16: the projected pro-forma - same computation as the workspace tab
  // (ONE implementation), exported when the deal can produce one.
  try {
    const pf = await computeDealProforma(supabase, {
      dealId,
      scenarioId: scenarioParam,
    });
    if (pf.state === "ready") {
      data.proforma = {
        entityName: pf.entityName,
        basePeriodLabel: pf.assumptions.basePeriodLabel,
        monthsCovered: pf.assumptions.monthsCovered,
        loanScenarioName: pf.loanScenarioName,
        growthBpsByYear: pf.assumptions.revenueGrowthBpsByYear,
        replacementSalaryCents: pf.assumptions.replacementSalaryCents,
        treatments: pf.assumptions.lineTreatments,
        baseAnnualized: {
          revenueCents: pf.projection.baseAnnualized.revenueCents.toString(),
          lines: pf.projection.baseAnnualized.lines.map((l) => ({
            label: l.label,
            amountCents: l.amountCents.toString(),
          })),
        },
        years: pf.projection.years.map((y) => ({
          label: y.label,
          revenueCents: y.revenueCents.toString(),
          lines: y.lines.map((l) => ({ label: l.label, amountCents: l.amountCents.toString() })),
          operatingExpensesCents: y.operatingExpensesCents.toString(),
          noiCents: y.noiCents.toString(),
          cfadsCents: y.cfadsCents.toString(),
          debtServiceCents: y.debtServiceCents.toString(),
        })),
      };
    }
  } catch {
    /* a deal without a projectable base still exports its spreads */
  }
  const workbook = buildWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `${(dealRes.data.name as string).replace(/[^\w-]+/g, "_")}_credexis.xlsx`;
  return new NextResponse(buffer as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  }) as NextResponse;
}
