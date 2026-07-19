/**
 * Engine core types (M7.1, Blueprint §7). Structural mirrors of the DB rows
 * — the engine cannot import @credexis/schema (zero-I/O boundary), so the
 * orchestration layer (M7.7) maps rows to these shapes. Money is `Cents`
 * everywhere; ratios are `FixedDecimal` (Iron Law #2).
 */

import type { Cents, FixedDecimal } from "@credexis/shared";
import type { RateStep } from "../amortization/amortization.js";

export interface EngineFact {
  id: string;
  entityId: string;
  /** Canonical period label ("FY2023", "TTM 2025-06", …). */
  periodLabel: string;
  taxonomyNodeKey: string | null;
  valueCents: Cents;
  method: "vendor" | "llm" | "consensus" | "transcript" | "override" | "human";
  status: "suggested" | "accepted" | "overridden" | "rejected";
}

export type AddbackCategory =
  | "officer_comp"
  | "depreciation_amortization"
  | "interest"
  | "one_time"
  | "rent_adjustment"
  | "discretionary";

export interface EngineAddback {
  id: string;
  /** Placement is resolved by the caller (via the linked fact, or manually). */
  entityId: string;
  periodLabel: string;
  category: AddbackCategory;
  state: "suggested" | "accepted" | "rejected";
  amountCents: Cents;
}

export interface EngineScenario {
  amountCents: Cents;
  termMonths: number;
  /** Resolved via resolveRateBps (prime + policy caps are the caller's data). */
  rateSteps: RateStep[];
  interestOnlyMonths?: number;
  /** Replacement salary for the working owner — the CFADS deduction. */
  replacementSalaryCents?: Cents;
}

export type MetricValue = { kind: "cents"; cents: Cents } | { kind: "ratio"; ratio: FixedDecimal };

export interface ComputedMetric {
  metric: string;
  /** Null = deal-global (scenario metrics). */
  entityId: string | null;
  /** Null = not period-scoped (debt service, loan terms). */
  periodLabel: string | null;
  value: MetricValue;
}

export interface EngineInput {
  facts: EngineFact[];
  addbacks: EngineAddback[];
  scenario: EngineScenario | null;
}

export interface EngineResult {
  engineVersion: string;
  metrics: ComputedMetric[];
}
