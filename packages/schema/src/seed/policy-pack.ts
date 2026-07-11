/**
 * SBA Policy Pack v2026-03 (M2.6) — SOP 50 10 8 thresholds as VERSIONED DATA
 * (Iron Law #8: the SOP changes; code must not). The engine (M7.5) evaluates
 * these rules; nothing anywhere hardcodes a threshold.
 *
 * Number encoding (Iron Law #2 — no floats near money):
 * - money: integer cents as string ("35000000" = $350,000.00)
 * - ratios (DSCR): fixed-point {mantissa, scale} → 1.15 = {115, 2}
 * - percentages: basis points (1000 bps = 10%)
 * - terms: whole months
 *
 * ⚠️ [PRATIK] REVIEW REQUIRED (task M2.6): every numeric below must be
 * checked against the current SOP 50 10 8 text before this pack is used on a
 * real deal. `reviewStatus` stays "draft" until then; the engine must refuse
 * to certify compliance under a draft pack.
 */

import { z } from "zod";

const centsString = z.string().regex(/^\d+$/);
const fixedPoint = z.object({ mantissa: z.number().int(), scale: z.number().int().min(0).max(6) });

export const policyRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Metric the engine evaluates this rule against (M7 metric DAG names). */
  metric: z.string().min(1),
  op: z.enum(["gte", "lte", "eq"]),
  /** Exactly one value encoding per rule. */
  ratio: fixedPoint.optional(),
  bps: z.number().int().optional(),
  months: z.number().int().optional(),
  cents: centsString.optional(),
  /** Structured applicability filter; empty = applies to every deal. */
  appliesWhen: z
    .object({
      dealTypes: z.array(z.string()).optional(),
      loanAmountCentsLte: centsString.optional(),
      loanAmountCentsGt: centsString.optional(),
      useOfProceeds: z.array(z.string()).optional(),
    })
    .default({}),
  sopCitation: z.string().min(1),
});

export const policyPackRulesSchema = z.object({
  sopReference: z.string(),
  reviewStatus: z.enum(["draft", "reviewed"]),
  reviewedBy: z.string().nullable(),
  rules: z.array(policyRuleSchema).min(1),
});

export type PolicyPackRules = z.infer<typeof policyPackRulesSchema>;

export const POLICY_PACK_VERSION = "sop-50-10-8-2026-03";
/** Stable seed id so re-seeding upserts instead of duplicating. */
export const POLICY_PACK_SEED_ID = "00000000-0000-4000-9000-000000000001";
export const POLICY_PACK_EFFECTIVE_DATE = "2026-03-01";

export const POLICY_PACK_2026_03: PolicyPackRules = {
  sopReference:
    "SOP 50 10 8, incl. technical updates effective for loans numbered on/after 2026-03-01",
  reviewStatus: "draft", // ⚠️ flips to "reviewed" only via [PRATIK] sign-off
  reviewedBy: null,
  rules: [
    {
      id: "dscr.standard",
      label: "Minimum DSCR — standard 7(a)",
      metric: "dscr_business",
      op: "gte",
      ratio: { mantissa: 115, scale: 2 }, // ≥ 1.15
      appliesWhen: { loanAmountCentsGt: "35000000" },
      sopCitation: "SOP 50 10 8 — credit standards, standard 7(a) (historical or projected)",
    },
    {
      id: "dscr.small_loan",
      label: "Minimum DSCR — 7(a) Small Loans ≤ $350k",
      metric: "dscr_business",
      op: "gte",
      ratio: { mantissa: 110, scale: 2 }, // ≥ 1.10
      appliesWhen: { loanAmountCentsLte: "35000000" },
      sopCitation: "SOP 50 10 8 technical updates (small-loan rules, eff. 2026-03-01)",
    },
    {
      id: "equity_injection.change_of_ownership",
      label: "Minimum equity injection — complete change of ownership",
      metric: "equity_injection_pct",
      op: "gte",
      bps: 1000, // 10%
      appliesWhen: { dealTypes: ["business_acquisition"] },
      sopCitation: "SOP 50 10 8 — complete changes of ownership require ≥10% equity injection",
    },
    {
      id: "term.working_capital",
      label: "Maximum term — working capital",
      metric: "term_months",
      op: "lte",
      months: 120, // 10 years
      appliesWhen: { useOfProceeds: ["working_capital"] },
      sopCitation: "SOP 50 10 8 — maturity limits (non-real-estate)",
    },
    {
      id: "term.equipment",
      label: "Maximum term — equipment (or useful life)",
      metric: "term_months",
      op: "lte",
      months: 120, // 10y default; useful-life exception is an underwriter call
      appliesWhen: { useOfProceeds: ["equipment"] },
      sopCitation: "SOP 50 10 8 — maturity limits (equipment; useful-life exception)",
    },
    {
      id: "term.business_acquisition",
      label: "Maximum term — business acquisition (no RE)",
      metric: "term_months",
      op: "lte",
      months: 120,
      appliesWhen: { dealTypes: ["business_acquisition"] },
      sopCitation: "SOP 50 10 8 — maturity limits (change of ownership without real estate)",
    },
    {
      id: "term.real_estate",
      label: "Maximum term — real estate",
      metric: "term_months",
      op: "lte",
      months: 300, // 25 years
      appliesWhen: { useOfProceeds: ["real_estate"], dealTypes: ["real_estate"] },
      sopCitation: "SOP 50 10 8 — maturity limits (real estate)",
    },
    {
      id: "guaranty.small",
      label: "SBA guaranty — loans ≤ $150k",
      metric: "sba_guaranty_pct",
      op: "eq",
      bps: 8500, // 85%
      appliesWhen: { loanAmountCentsLte: "15000000" },
      sopCitation: "15 U.S.C. 636(a) / SOP 50 10 8 — guaranty percentages",
    },
    {
      id: "guaranty.large",
      label: "SBA guaranty — loans > $150k",
      metric: "sba_guaranty_pct",
      op: "eq",
      bps: 7500, // 75%
      appliesWhen: { loanAmountCentsGt: "15000000" },
      sopCitation: "15 U.S.C. 636(a) / SOP 50 10 8 — guaranty percentages",
    },
    {
      id: "loan.max_amount",
      label: "Maximum 7(a) loan amount",
      metric: "loan_amount",
      op: "lte",
      cents: "500000000", // $5,000,000
      appliesWhen: {},
      sopCitation: "SOP 50 10 8 — 7(a) program maximums",
    },
  ],
};
