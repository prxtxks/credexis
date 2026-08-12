/**
 * Deal pro-forma computation (M15/M16): ONE implementation behind both the
 * tRPC endpoint and the XLSX export, so the workbook a banker downloads
 * can never disagree with the tab they reviewed (Iron Law #3: metrics are
 * computed in exactly one place).
 */

import { TAXONOMY_V1 } from "@credexis/schema";
import {
  defaultTreatment,
  projectProforma,
  type LineTreatment,
  type ProformaBase,
  type ProformaLoan,
} from "@credexis/engine";
import { cents, sumCents, ZERO_CENTS, type Cents } from "@credexis/shared";
import { scenarioFromRow, type ScenarioRow } from "../metrics/logic";

const NODE_LABEL = new Map(TAXONOMY_V1.map((n) => [n.key, n.label]));

export interface ProformaComputeParams {
  dealId: string;
  scenarioId?: string | null;
  preview?: {
    basePeriodLabel?: string | undefined;
    monthsCovered?: number | undefined;
    revenueGrowthBpsByYear?: number[] | undefined;
    lineTreatments?: Record<string, "ratio" | "fixed" | "excluded"> | undefined;
    replacementSalaryCents?: string | undefined;
  };
}

/* Errors from the DB layer are thrown as plain Error - the tRPC router
 * wraps them; the export route turns them into a 500 with the message. */
class DbError extends Error {}

function bigintFromDb(v: unknown): bigint {
  if (typeof v === "string") return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  throw new Error(`unexpected cents value: ${String(v)}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeDealProforma(supabase: any, params: ProformaComputeParams) {
  // ── The target entity anchors the projection ──
  const { data: ents, error: entErr } = await supabase
    .from("entities")
    .select("id, name, kind")
    .eq("deal_id", params.dealId);
  if (entErr) throw new DbError(entErr.message);
  const target =
    (ents ?? []).find((e: { kind: string }) => e.kind === "target") ??
    (ents ?? []).find((e: { kind: string }) => e.kind === "applicant") ??
    (ents ?? [])[0];
  if (!target) {
    return { state: "no_entity" as const };
  }

  // ── Accepted facts of the target, grouped by period ──
  // Lineage columns ride along so every base line can DISCLOSE the printed
  // source lines that built it (M21: a number an underwriter can open).
  const { data: facts, error: fErr } = await supabase
    .from("facts")
    .select(
      "taxonomy_node_key, value_cents, status, method, source_page, registry_field_id, source_logical_document_id, periods(label)",
    )
    .eq("entity_id", target.id as string)
    .in("status", ["accepted", "overridden"]);
  if (fErr) throw new DbError(fErr.message);

  interface FactMeta {
    valueCents: Cents;
    method: string;
    page: number | null;
    registryFieldId: string | null;
    logicalDocumentId: string | null;
  }
  const byPeriod = new Map<string, Map<string, FactMeta[]>>();
  for (const f of facts ?? []) {
    const label = (f.periods as unknown as { label: string } | null)?.label;
    const key = f.taxonomy_node_key as string | null;
    if (!label || !key || !key.startsWith("is.")) continue;
    const period = byPeriod.get(label) ?? new Map<string, FactMeta[]>();
    const list = period.get(key) ?? [];
    list.push({
      valueCents: cents(bigintFromDb(f.value_cents)),
      method: f.method as string,
      page: (f.source_page as number | null) ?? null,
      registryFieldId: (f.registry_field_id as string | null) ?? null,
      logicalDocumentId: (f.source_logical_document_id as string | null) ?? null,
    });
    period.set(key, list);
    byPeriod.set(label, period);
  }
  const periods = [...byPeriod.keys()].sort();
  if (periods.length === 0) {
    return { state: "no_accepted_facts" as const, entityName: target.name as string };
  }

  // ── Stored assumptions (or defaults), preview overrides on top ──
  const { data: stored, error: aErr } = await supabase
    .from("proforma_assumptions")
    .select("*")
    .eq("deal_id", params.dealId)
    .maybeSingle();
  if (aErr) throw new DbError(aErr.message);

  const basePeriodLabel =
    params.preview?.basePeriodLabel ??
    (stored?.base_period_label as string | undefined) ??
    periods[periods.length - 1]!;
  const period = byPeriod.get(basePeriodLabel);
  if (!period) {
    return { state: "base_period_gone" as const, basePeriodLabel, periods };
  }
  const monthsCovered =
    params.preview?.monthsCovered ?? (stored?.months_covered as number | undefined) ?? 12;
  const growth = params.preview?.revenueGrowthBpsByYear ??
    (stored?.revenue_growth_bps as number[] | undefined) ?? [0, 0, 0];
  const storedTreatments =
    params.preview?.lineTreatments ??
    (stored?.line_treatments as Record<string, string> | undefined) ??
    {};
  const replacementSalaryCents = cents(
    BigInt(
      params.preview?.replacementSalaryCents ??
        String((stored?.replacement_salary_cents as unknown) ?? "0"),
    ),
  );

  // ── Assemble the base: revenue + every expense-side line ──
  const sumKey = (key: string): Cents => sumCents((period.get(key) ?? []).map((m) => m.valueCents));
  const revenue =
    period.has("is.revenue.total") && sumKey("is.revenue.total") !== 0n
      ? sumKey("is.revenue.total")
      : sumCents(
          [...period.keys()].filter((k) => k.startsWith("is.revenue.")).map((k) => sumKey(k)),
        );

  // Document descriptors for the base period's lineage disclosure -
  // "PNL FY2024 · p. 1" is what an underwriter recognizes.
  const docIds = [
    ...new Set(
      [...period.values()]
        .flat()
        .flatMap((m) => (m.logicalDocumentId ? [m.logicalDocumentId] : [])),
    ),
  ];
  const docLabel = new Map<string, string>();
  if (docIds.length > 0) {
    const { data: ldocs, error: ldErr } = await supabase
      .from("logical_documents")
      .select("id, form_family, tax_year")
      .in("id", docIds);
    if (ldErr) throw new DbError(ldErr.message);
    for (const ld of ldocs ?? []) {
      const year = ld.tax_year !== null ? ` ${ld.tax_year}` : "";
      docLabel.set(ld.id as string, `${ld.form_family}${year}`);
    }
  }

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
        // Composition disclosure (M21): the base-period facts behind this
        // line, one row per printed source. Rendered, never re-added, by
        // the client; the engine's sums stay the only arithmetic.
        sources: (period.get(key) ?? []).map((m) => ({
          valueCents: m.valueCents,
          method: m.method,
          page: m.page,
          registryFieldId: m.registryFieldId,
          docLabel: m.logicalDocumentId ? (docLabel.get(m.logicalDocumentId) ?? null) : null,
        })),
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
  if (params.scenarioId) {
    const { data: srow, error: sErr } = await supabase
      .from("loan_scenarios")
      .select("id, name, amount_cents, rate_spec, term_months, structure")
      .eq("id", params.scenarioId)
      .eq("deal_id", params.dealId)
      .maybeSingle();
    if (sErr) throw new DbError(sErr.message);
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
}
