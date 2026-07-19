/**
 * Rule-suggested addbacks (M7.3, Blueprint §7): deterministic mapping from
 * accepted facts to `suggested` addback candidates. Pure — the API layer
 * persists these (deduped) into the ONE addbacks table (post-mortem trap 8:
 * suggestions and human decisions share a single model; the engine's DAG
 * reads accepted rows only).
 *
 * Sign convention: expense-side lines add BACK at face value (they reduced
 * NI but not cash available); one-time INCOME lines (insurance proceeds,
 * PPP/ERC) suggest a NEGATIVE amount — they inflated NI and come out.
 *
 * Rent adjustments and other judgment calls (above/below-market rent, a
 * "one working owner" determination) have no rule here — a human creates
 * those addbacks explicitly in the UI.
 */

import { negateCents, type Cents } from "@credexis/shared";
import type { AddbackCategory, EngineFact } from "../core/types.js";

export interface AddbackSuggestion {
  factId: string;
  entityId: string;
  periodLabel: string;
  category: AddbackCategory;
  amountCents: Cents;
  rationale: string;
}

interface Rule {
  category: AddbackCategory;
  /** Income-side lines are negated — they come OUT of cash flow. */
  negate: boolean;
  rationale: string;
}

/** Taxonomy keys are stable identities (schema seed doc) — safe to key on. */
const RULES: Readonly<Record<string, Rule>> = {
  "is.opex.depreciation": {
    category: "depreciation_amortization",
    negate: false,
    rationale: "Depreciation is non-cash (EBITDA bridge).",
  },
  "is.opex.amortization": {
    category: "depreciation_amortization",
    negate: false,
    rationale: "Amortization is non-cash (EBITDA bridge).",
  },
  "is.other.interest_expense": {
    category: "interest",
    negate: false,
    rationale: "Interest is financing cost, replaced by the new debt service (EBITDA bridge).",
  },
  "is.opex.officer_comp": {
    category: "officer_comp",
    negate: false,
    rationale: "Officer compensation — adjust for one working owner vs replacement salary.",
  },
  "is.opex.management_fees": {
    category: "discretionary",
    negate: false,
    rationale: "Management fees are frequently discretionary/related-party — verify.",
  },
  "is.other.one_time_items": {
    category: "one_time",
    negate: false,
    rationale: "Marked one-time / non-recurring on the statement.",
  },
  "is.other.insurance_proceeds": {
    category: "one_time",
    negate: true,
    rationale: "One-time insurance proceeds inflated net income — backed out.",
  },
  "is.other.ppp_erc_grants": {
    category: "one_time",
    negate: true,
    rationale: "PPP/ERC relief is non-recurring income — backed out.",
  },
};

const METHOD_RANK: Record<EngineFact["method"], number> = {
  vendor: 0,
  llm: 0,
  consensus: 1,
  transcript: 2,
  human: 3,
  override: 4,
};

export function suggestAddbacks(facts: EngineFact[]): AddbackSuggestion[] {
  // Highest-authority accepted fact per entity+period+node — same selection
  // the metric DAG uses, so suggestions always mirror what EBITDA reads.
  const best = new Map<string, EngineFact>();
  for (const f of facts) {
    if (f.status !== "accepted" || f.taxonomyNodeKey === null) continue;
    if (!(f.taxonomyNodeKey in RULES)) continue;
    const key = `${f.entityId}|${f.periodLabel}|${f.taxonomyNodeKey}`;
    const cur = best.get(key);
    if (!cur || METHOD_RANK[f.method] > METHOD_RANK[cur.method]) best.set(key, f);
  }

  const suggestions: AddbackSuggestion[] = [];
  for (const f of best.values()) {
    const rule = RULES[f.taxonomyNodeKey!]!;
    if (BigInt(f.valueCents) === 0n) continue;
    suggestions.push({
      factId: f.id,
      entityId: f.entityId,
      periodLabel: f.periodLabel,
      category: rule.category,
      amountCents: rule.negate ? negateCents(f.valueCents) : f.valueCents,
      rationale: rule.rationale,
    });
  }
  return suggestions;
}
