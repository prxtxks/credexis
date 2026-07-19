/**
 * The metric DAG (M7.1, Blueprint §7) — the ONLY place metrics are computed
 * (Iron Law #3). Pure: (facts, addbacks, scenario) → versioned metric set.
 *
 * Conventions (each one is load-bearing; the tests pin them):
 * - Only `accepted` facts participate; among duplicates on one node the
 *   highest-authority method wins (override > human > transcript >
 *   consensus > vendor/llm).
 * - A stated `.total` fact wins over Σ(items). Reconciling a disagreeing
 *   total is G1's job (a blocking issue) — the engine never silently
 *   "fixes" finalized data.
 * - Addbacks: accepted only (ONE model — post-mortem trap 8). The
 *   depreciation_amortization and interest categories are the EBITDA
 *   bridge (those dollars enter via the fact terms in EBITDA) and are
 *   NEVER added again into SDE.
 * - Ratios: FixedDecimal at scale 2, banker's rounding, and a zero/negative
 *   denominator omits the metric rather than throwing (a partial spread is
 *   normal mid-underwriting).
 */

import {
  addCents,
  cents,
  divideCentsToDecimal,
  makeDecimal,
  subCents,
  sumCents,
  type Cents,
} from "@credexis/shared";
import { amortize } from "../amortization/amortization.js";
import type {
  ComputedMetric,
  EngineFact,
  EngineInput,
  EngineResult,
  MetricValue,
} from "./types.js";

export const ENGINE_VERSION = "engine-v0.1.0";

const RATIO_SCALE = 2;

/** Same authority order the gates use — override supersedes everything. */
const METHOD_RANK: Record<EngineFact["method"], number> = {
  vendor: 0,
  llm: 0,
  consensus: 1,
  transcript: 2,
  human: 3,
  override: 4,
};

const centsValue = (v: Cents): MetricValue => ({ kind: "cents", cents: v });

class PeriodLedger {
  private byNode = new Map<string, EngineFact>();

  add(f: EngineFact): void {
    if (f.taxonomyNodeKey === null) return;
    const cur = this.byNode.get(f.taxonomyNodeKey);
    if (!cur || METHOD_RANK[f.method] > METHOD_RANK[cur.method]) {
      this.byNode.set(f.taxonomyNodeKey, f);
    }
  }

  /** The value at a node, or null when no fact landed there. */
  node(key: string): Cents | null {
    return this.byNode.get(key)?.valueCents ?? null;
  }

  /** Σ of direct item facts under `prefix` (excluding its `.total`). */
  sumItems(prefix: string): Cents | null {
    const items: Cents[] = [];
    for (const [key, f] of this.byNode) {
      if (!key.startsWith(`${prefix}.`) || key === `${prefix}.total`) continue;
      items.push(f.valueCents);
    }
    return items.length > 0 ? sumCents(items) : null;
  }

  /** Stated `.total` first, else Σ(items) — the spread convention. */
  section(prefix: string): Cents | null {
    return this.node(`${prefix}.total`) ?? this.sumItems(prefix);
  }
}

function computePeriodMetrics(
  entityId: string,
  periodLabel: string,
  ledger: PeriodLedger,
  input: EngineInput,
): ComputedMetric[] {
  const out: ComputedMetric[] = [];
  const emitCents = (metric: string, v: Cents | null) => {
    if (v !== null) out.push({ metric, entityId, periodLabel, value: centsValue(v) });
    return v;
  };
  const emitRatio = (metric: string, numerator: Cents | null, denominator: Cents | null) => {
    if (numerator === null || denominator === null || BigInt(denominator) <= 0n) return;
    out.push({
      metric,
      entityId,
      periodLabel,
      value: { kind: "ratio", ratio: divideCentsToDecimal(numerator, denominator, RATIO_SCALE) },
    });
  };

  /* ── income statement walk ──────────────────────────────────────────── */
  const revenue = emitCents("revenue_total", ledger.section("is.revenue"));
  const cogs = ledger.section("is.cogs");
  const grossProfit = emitCents(
    "gross_profit",
    ledger.node("is.gross_profit") ??
      (revenue !== null ? subCents(revenue, cogs ?? cents(0n)) : null),
  );
  const opex = ledger.section("is.opex");
  const other = ledger.section("is.other");
  const tax = ledger.node("is.income_tax");

  let netIncome = ledger.node("is.net_income");
  if (netIncome === null && grossProfit !== null) {
    const pretax =
      ledger.node("is.pretax_income") ??
      addCents(subCents(grossProfit, opex ?? cents(0n)), other ?? cents(0n));
    netIncome = subCents(pretax, tax ?? cents(0n));
  }
  emitCents("net_income", netIncome);

  let ebitda: Cents | null = null;
  if (netIncome !== null) {
    ebitda = sumCents([
      netIncome,
      ledger.node("is.other.interest_expense") ?? cents(0n),
      tax ?? cents(0n),
      ledger.node("is.opex.depreciation") ?? cents(0n),
      ledger.node("is.opex.amortization") ?? cents(0n),
    ]);
    emitCents("ebitda", ebitda);
  }

  /* ── SDE / CFADS (accepted addbacks only — trap 8) ──────────────────── */
  if (ebitda !== null) {
    const ownerBenefit = input.addbacks
      .filter(
        (a) =>
          a.state === "accepted" &&
          a.entityId === entityId &&
          a.periodLabel === periodLabel &&
          a.category !== "depreciation_amortization" &&
          a.category !== "interest",
      )
      .map((a) => a.amountCents);
    const sde = addCents(ebitda, sumCents(ownerBenefit));
    emitCents("sde", sde);

    const replacement = input.scenario?.replacementSalaryCents ?? cents(0n);
    emitCents("cfads", subCents(sde, replacement));
  }

  /* ── balance sheet ──────────────────────────────────────────────────── */
  const currentAssets = ledger.section("bs.assets.current");
  const currentLiabilities = ledger.section("bs.liabilities.current");
  if (currentAssets !== null && currentLiabilities !== null) {
    emitCents("working_capital", subCents(currentAssets, currentLiabilities));
  }
  emitRatio("current_ratio", currentAssets, currentLiabilities);

  const totalLiabilities = ledger.section("bs.liabilities");
  const equity = ledger.section("bs.equity");
  if (equity !== null) {
    const tnw = subCents(
      subCents(equity, ledger.node("bs.assets.other.intangibles") ?? cents(0n)),
      ledger.node("bs.assets.other.goodwill") ?? cents(0n),
    );
    emitCents("tangible_net_worth", tnw);
    emitRatio("debt_to_tnw", totalLiabilities, tnw);
  }

  /* ── guarantor personal cash flow (M7.4) ────────────────────────────── */
  // Personal debt service (mortgage, auto, cards, …) lives INSIDE the
  // outflow section, so personal_cash_flow is already net of it — the
  // global DSCR denominator stays the business loan's debt service.
  const personalIncome = ledger.section("pcf.income");
  const personalOutflow = ledger.section("pcf.outflow");
  if (personalIncome !== null || personalOutflow !== null) {
    emitCents("personal_income_total", personalIncome);
    emitCents("personal_outflow_total", personalOutflow);
    emitCents(
      "personal_cash_flow",
      subCents(personalIncome ?? cents(0n), personalOutflow ?? cents(0n)),
    );
  }

  return out;
}

export function computeMetrics(input: EngineInput): EngineResult {
  const metrics: ComputedMetric[] = [];

  // Group accepted facts by entity+period; each cell computes independently.
  const ledgers = new Map<
    string,
    { entityId: string; periodLabel: string; ledger: PeriodLedger }
  >();
  for (const f of input.facts) {
    if (f.status !== "accepted") continue;
    const key = `${f.entityId}|${f.periodLabel}`;
    let cell = ledgers.get(key);
    if (!cell) {
      cell = { entityId: f.entityId, periodLabel: f.periodLabel, ledger: new PeriodLedger() };
      ledgers.set(key, cell);
    }
    cell.ledger.add(f);
  }

  const cfadsByCell = new Map<string, Cents>();
  const globalByPeriod = new Map<string, Cents>(); // Σ CFADS + Σ personal CF
  const addToGlobal = (periodLabel: string, v: Cents) => {
    globalByPeriod.set(periodLabel, addCents(globalByPeriod.get(periodLabel) ?? cents(0n), v));
  };
  for (const { entityId, periodLabel, ledger } of ledgers.values()) {
    const cellMetrics = computePeriodMetrics(entityId, periodLabel, ledger, input);
    metrics.push(...cellMetrics);
    for (const m of cellMetrics) {
      if (m.value.kind !== "cents") continue;
      if (m.metric === "cfads") {
        cfadsByCell.set(`${entityId}|${periodLabel}`, m.value.cents);
        addToGlobal(periodLabel, m.value.cents);
      }
      if (m.metric === "personal_cash_flow") addToGlobal(periodLabel, m.value.cents);
    }
  }

  /* ── global cash flow per period (M7.4, deal-scoped) ────────────────── */
  for (const [periodLabel, v] of globalByPeriod) {
    metrics.push({
      metric: "global_cash_flow",
      entityId: null,
      periodLabel,
      value: centsValue(v),
    });
  }

  /* ── scenario metrics (deal-global) ─────────────────────────────────── */
  if (input.scenario) {
    const s = input.scenario;
    const ads = amortize({
      principalCents: s.amountCents,
      termMonths: s.termMonths,
      rateSteps: s.rateSteps,
      ...(s.interestOnlyMonths !== undefined ? { interestOnlyMonths: s.interestOnlyMonths } : {}),
    }).annualDebtServiceCents;

    metrics.push(
      { metric: "annual_debt_service", entityId: null, periodLabel: null, value: centsValue(ads) },
      {
        metric: "loan_amount",
        entityId: null,
        periodLabel: null,
        value: centsValue(s.amountCents),
      },
      {
        metric: "term_months",
        entityId: null,
        periodLabel: null,
        value: { kind: "ratio", ratio: makeDecimal(BigInt(s.termMonths), 0) },
      },
    );

    // Structure metrics for the policy vocabulary (M7.5). Percentages are
    // scale-4 ratios (1000 mantissa = 10.00%) — the bps encoding as decimal.
    const st = s.structure;
    if (
      st?.equityInjectionCents !== undefined &&
      st.totalProjectCostCents !== undefined &&
      BigInt(st.totalProjectCostCents) > 0n
    ) {
      metrics.push({
        metric: "equity_injection_pct",
        entityId: null,
        periodLabel: null,
        value: {
          kind: "ratio",
          ratio: divideCentsToDecimal(st.equityInjectionCents, st.totalProjectCostCents, 4),
        },
      });
    }
    if (st?.sbaGuarantyBps !== undefined) {
      metrics.push({
        metric: "sba_guaranty_pct",
        entityId: null,
        periodLabel: null,
        value: { kind: "ratio", ratio: makeDecimal(BigInt(st.sbaGuarantyBps), 4) },
      });
    }

    // DSCR per entity+period wherever CFADS exists (the spread's DSCR row).
    if (BigInt(ads) > 0n) {
      for (const [key, cfads] of cfadsByCell) {
        const [entityId, periodLabel] = key.split("|") as [string, string];
        metrics.push({
          metric: "dscr_business",
          entityId,
          periodLabel,
          value: { kind: "ratio", ratio: divideCentsToDecimal(cfads, ads, RATIO_SCALE) },
        });
      }
      // Global DSCR (M7.4): combined cash flow over the same debt service —
      // personal debt service is already inside personal outflows.
      for (const [periodLabel, gcf] of globalByPeriod) {
        metrics.push({
          metric: "dscr_global",
          entityId: null,
          periodLabel,
          value: { kind: "ratio", ratio: divideCentsToDecimal(gcf, ads, RATIO_SCALE) },
        });
      }
    }
  }

  return { engineVersion: ENGINE_VERSION, metrics };
}
