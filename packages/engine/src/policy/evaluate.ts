/**
 * Policy evaluation (M7.5, Blueprint §7): pass/fail/margin per rule from a
 * VERSIONED policy pack (Iron Law #8 — thresholds are data; a deal pins the
 * pack version it was underwritten under). Pure: rules + deal shape +
 * metric values in, verdicts out.
 *
 * Certification: a `draft` pack (not yet [PRATIK]-reviewed against the SOP
 * text) always yields `not_certifiable` overall — rule verdicts still
 * compute so the UI can show an advisory compliance strip.
 */

import {
  compareDecimal,
  makeDecimal,
  rescaleDecimal,
  type Cents,
  type FixedDecimal,
} from "@credexis/shared";
import type { MetricValue } from "../core/types.js";

/** Structural mirrors of @credexis/schema's policyRuleSchema (zero-I/O boundary). */
export interface PolicyRuleInput {
  id: string;
  label: string;
  metric: string;
  op: "gte" | "lte" | "eq";
  ratio?: { mantissa: number; scale: number };
  bps?: number;
  months?: number;
  /** Integer cents as string. */
  cents?: string;
  appliesWhen: {
    dealTypes?: string[];
    loanAmountCentsLte?: string;
    loanAmountCentsGt?: string;
    useOfProceeds?: string[];
  };
  sopCitation?: string;
}

export interface PolicyPackInput {
  sopReference: string;
  reviewStatus: "draft" | "reviewed";
  reviewedBy: string | null;
  rules: PolicyRuleInput[];
}

export interface PolicyDealShape {
  dealType: string;
  useOfProceeds: string[];
  loanAmountCents: Cents;
}

export type RuleStatus = "pass" | "fail" | "not_evaluable";

export interface RuleResult {
  ruleId: string;
  label: string;
  metric: string;
  status: RuleStatus;
  /** The metric value the rule saw (absent when not evaluable). */
  actual?: MetricValue;
  /**
   * Signed distance from the threshold in the rule's own unit — positive is
   * headroom, negative is shortfall (for `eq`, the deviation). Absent when
   * not evaluable.
   */
  margin?: FixedDecimal;
}

export interface PolicyEvaluation {
  sopReference: string;
  certifiable: boolean;
  overall: "pass" | "fail" | "incomplete" | "not_certifiable";
  rules: RuleResult[];
}

export interface PolicyEvaluationInput {
  pack: PolicyPackInput;
  deal: PolicyDealShape;
  /**
   * Metric values for the underwriting basis (the orchestration layer picks
   * the basis period and flattens deal-global + scenario metrics into this).
   */
  metrics: Record<string, MetricValue>;
}

function applies(rule: PolicyRuleInput, deal: PolicyDealShape): boolean {
  const w = rule.appliesWhen;
  const amount = BigInt(deal.loanAmountCents);
  if (w.dealTypes && !w.dealTypes.includes(deal.dealType)) return false;
  if (w.loanAmountCentsLte !== undefined && amount > BigInt(w.loanAmountCentsLte)) return false;
  if (w.loanAmountCentsGt !== undefined && amount <= BigInt(w.loanAmountCentsGt)) return false;
  if (w.useOfProceeds && !w.useOfProceeds.some((u) => deal.useOfProceeds.includes(u))) {
    return false;
  }
  return true;
}

/** The rule's threshold and the metric's actual, on one decimal scale. */
function comparable(
  rule: PolicyRuleInput,
  actual: MetricValue,
): { actualDec: FixedDecimal; requiredDec: FixedDecimal } | null {
  if (rule.ratio !== undefined && actual.kind === "ratio") {
    const scale = Math.max(actual.ratio.scale, rule.ratio.scale);
    return {
      actualDec: rescaleDecimal(actual.ratio, scale),
      requiredDec: rescaleDecimal(
        makeDecimal(BigInt(rule.ratio.mantissa), rule.ratio.scale),
        scale,
      ),
    };
  }
  if (rule.bps !== undefined && actual.kind === "ratio") {
    // bps = value at scale 4 (1000 bps = 0.1000).
    const scale = Math.max(actual.ratio.scale, 4);
    return {
      actualDec: rescaleDecimal(actual.ratio, scale),
      requiredDec: rescaleDecimal(makeDecimal(BigInt(rule.bps), 4), scale),
    };
  }
  if (rule.months !== undefined && actual.kind === "ratio") {
    const scale = actual.ratio.scale;
    return {
      actualDec: actual.ratio,
      requiredDec: rescaleDecimal(makeDecimal(BigInt(rule.months), 0), scale),
    };
  }
  if (rule.cents !== undefined && actual.kind === "cents") {
    return {
      actualDec: makeDecimal(BigInt(actual.cents), 0),
      requiredDec: makeDecimal(BigInt(rule.cents), 0),
    };
  }
  return null; // encoding mismatch — treated as not evaluable
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluation {
  const results: RuleResult[] = [];

  for (const rule of input.pack.rules) {
    if (!applies(rule, input.deal)) continue;

    const actual = input.metrics[rule.metric];
    const pair = actual === undefined ? null : comparable(rule, actual);
    if (actual === undefined || pair === null) {
      results.push({
        ruleId: rule.id,
        label: rule.label,
        metric: rule.metric,
        status: "not_evaluable",
      });
      continue;
    }

    const cmp = compareDecimal(pair.actualDec, pair.requiredDec);
    const pass = rule.op === "gte" ? cmp >= 0 : rule.op === "lte" ? cmp <= 0 : cmp === 0;

    // Signed margin: headroom positive, shortfall negative, in rule units.
    const diff = makeDecimal(
      rule.op === "lte"
        ? pair.requiredDec.mantissa - pair.actualDec.mantissa
        : pair.actualDec.mantissa - pair.requiredDec.mantissa,
      pair.actualDec.scale,
    );

    results.push({
      ruleId: rule.id,
      label: rule.label,
      metric: rule.metric,
      status: pass ? "pass" : "fail",
      actual,
      margin: diff,
    });
  }

  const certifiable = input.pack.reviewStatus === "reviewed";
  const anyFail = results.some((r) => r.status === "fail");
  const anyGap = results.some((r) => r.status === "not_evaluable");
  const overall: PolicyEvaluation["overall"] = !certifiable
    ? "not_certifiable"
    : anyFail
      ? "fail"
      : anyGap
        ? "incomplete"
        : "pass";

  return { sopReference: input.pack.sopReference, certifiable, overall, rules: results };
}
