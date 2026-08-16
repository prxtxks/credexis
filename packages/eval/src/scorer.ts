/**
 * Deterministic scorer: extracted fields vs ground truth (M1.4).
 *
 * Field identity is (registry_field_id | taxonomy_node, period). Values match
 * on exact cents equality (null matches null — correctly reporting a blank
 * field is a correct extraction). Ratios are plain numbers (not money);
 * costs stay bigint micro-USD.
 */

import type { GroundTruthDocument } from "@credexis/schema";
import type { ExtractionResult } from "./types.js";

export interface DocumentScore {
  id: string;
  form_family: string;
  quality: string;
  synthetic: boolean;
  /** Extracted value matches ground truth (incl. null==null). */
  correct: number;
  /** Extracted value differs from ground truth. */
  wrong: number;
  /** In ground truth, never extracted. */
  missed: number;
  /** Extracted for a (field, period) not in ground truth. */
  spurious: number;
  /** Open-set mode only: extractions outside the labeled set (reported, not penalized). */
  uncovered: number;
  auto_accepted: number;
  auto_accepted_correct: number;
  /** Wrong or spurious values that were auto-accepted — the cardinal sin. */
  silent_wrong: number;
  ground_truth_fields: number;
  cost_micro_usd: bigint;
  /** Field-level autopsy: which identities were missed/wrong (additive —
   *  aggregate consumers and the CI baseline ignore it). */
  detail: {
    missed_keys: string[];
    wrong_values: { key: string; expected: string | null; got: string | null }[];
  };
}

export interface MetricsSummary {
  documents: number;
  ground_truth_fields: number;
  /** correct / (correct + wrong + spurious) over extracted values. */
  field_precision: number | null;
  /** correct / ground truth fields. */
  field_recall: number | null;
  /** auto-accepted correct / auto-accepted. */
  auto_accept_precision: number | null;
  /** auto-accepted / ground truth fields. */
  auto_accept_coverage: number | null;
  /** MUST be 0 (wrong values that skipped review). */
  silent_wrong_count: number;
  per_form: Record<string, { fields: number; precision: number | null; recall: number | null }>;
  per_quality: Record<string, { fields: number; precision: number | null; recall: number | null }>;
  cost_micro_usd_total: bigint;
  cost_micro_usd_per_doc: bigint;
}

function fieldKey(f: {
  registry_field_id?: string | undefined;
  taxonomy_node?: string | undefined;
  period: string;
}) {
  return `${f.registry_field_id ?? ""}|${f.taxonomy_node ?? ""}|${f.period}`;
}

/**
 * Aggregate same-key fields (two printed lines mapping to one taxonomy
 * node — e.g. "Pest Control" and "Trash Removal" both → is.opex.misc):
 * the node-level truth IS the sum of its mapped lines. Values are summed
 * over non-null parts (all-null → null); a merged extraction counts as
 * auto-accepted only when EVERY part was (a review-flagged part means
 * the node's value never fully skipped review).
 */
function aggregateByKey<
  T extends {
    registry_field_id?: string | undefined;
    taxonomy_node?: string | undefined;
    period: string;
    value_cents: bigint | null;
    outcome?: string;
  },
>(fields: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const f of fields) {
    const key = fieldKey(f);
    const prev = out.get(key);
    if (!prev) {
      out.set(key, { ...f });
      continue;
    }
    const sum =
      prev.value_cents === null && f.value_cents === null
        ? null
        : (prev.value_cents ?? 0n) + (f.value_cents ?? 0n);
    out.set(key, {
      ...prev,
      value_cents: sum,
      ...(prev.outcome !== undefined || f.outcome !== undefined
        ? {
            outcome:
              prev.outcome === "auto_accept" && f.outcome === "auto_accept"
                ? "auto_accept"
                : "review",
          }
        : {}),
    });
  }
  return out;
}

/** Score one document's extraction against its ground truth. */
export interface ScoreOptions {
  /**
   * Open-set ground truth (statements): labels cover totals + majors, not
   * every printed line — an extraction outside the labeled set is
   * "uncovered", not wrong. Tax forms stay closed-set: the registry
   * defines the complete field universe, so unknown keys ARE spurious.
   */
  openSet?: boolean;
}

export function scoreDocument(
  gt: GroundTruthDocument,
  result: ExtractionResult,
  opts: ScoreOptions = {},
): DocumentScore {
  const truthByKey = aggregateByKey(gt.fields);
  const aggregatedExtraction = [...aggregateByKey(result.fields).values()];
  const seen = new Set<string>();

  let correct = 0;
  let wrong = 0;
  let spurious = 0;
  let uncovered = 0;
  let autoAccepted = 0;
  let autoAcceptedCorrect = 0;
  let silentWrong = 0;
  const wrongValues: DocumentScore["detail"]["wrong_values"] = [];

  for (const ex of aggregatedExtraction) {
    const key = fieldKey(ex);
    if (seen.has(key)) {
      // Duplicate extraction for the same identity: everything after the
      // first is spurious (and silent if auto-accepted).
      spurious += 1;
      if (ex.outcome === "auto_accept") silentWrong += 1;
      continue;
    }
    seen.add(key);
    const truth = truthByKey.get(key);
    const isAuto = ex.outcome === "auto_accept";
    if (isAuto) autoAccepted += 1;

    if (truth === undefined) {
      if (opts.openSet) {
        uncovered += 1; // outside the labeled set — reported, not penalized
      } else {
        spurious += 1;
        if (isAuto) silentWrong += 1;
      }
      continue;
    }
    const matches = truth.value_cents === ex.value_cents;
    if (!matches) {
      wrongValues.push({
        key,
        expected: truth.value_cents === null ? null : truth.value_cents.toString(),
        got: ex.value_cents === null ? null : ex.value_cents.toString(),
      });
    }
    if (matches) {
      correct += 1;
      if (isAuto) autoAcceptedCorrect += 1;
    } else {
      wrong += 1;
      if (isAuto) silentWrong += 1;
    }
  }

  const missed = gt.fields.length - [...seen].filter((k) => truthByKey.has(k)).length;
  const missedKeys = [...truthByKey.keys()].filter((k) => !seen.has(k));

  return {
    detail: { missed_keys: missedKeys, wrong_values: wrongValues },
    id: gt.id,
    form_family: gt.form_family,
    quality: gt.quality,
    synthetic: gt.synthetic,
    correct,
    wrong,
    missed,
    spurious,
    uncovered,
    auto_accepted: autoAccepted,
    auto_accepted_correct: autoAcceptedCorrect,
    silent_wrong: silentWrong,
    ground_truth_fields: gt.fields.length,
    cost_micro_usd: result.cost_micro_usd,
  };
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

/** Aggregate document scores into a metrics summary. */
export function summarize(scores: readonly DocumentScore[]): MetricsSummary {
  const total = (sel: (s: DocumentScore) => number) => scores.reduce((a, s) => a + sel(s), 0);
  const correct = total((s) => s.correct);
  const wrong = total((s) => s.wrong);
  const spurious = total((s) => s.spurious);
  const gtFields = total((s) => s.ground_truth_fields);
  const auto = total((s) => s.auto_accepted);
  const autoCorrect = total((s) => s.auto_accepted_correct);

  const group = (key: (s: DocumentScore) => string) => {
    const out: Record<string, { fields: number; precision: number | null; recall: number | null }> =
      {};
    for (const k of new Set(scores.map(key))) {
      const subset = scores.filter((s) => key(s) === k);
      const c = subset.reduce((a, s) => a + s.correct, 0);
      const w = subset.reduce((a, s) => a + s.wrong, 0);
      const sp = subset.reduce((a, s) => a + s.spurious, 0);
      const g = subset.reduce((a, s) => a + s.ground_truth_fields, 0);
      out[k] = { fields: g, precision: ratio(c, c + w + sp), recall: ratio(c, g) };
    }
    return out;
  };

  const costTotal = scores.reduce((a, s) => a + s.cost_micro_usd, 0n);
  return {
    documents: scores.length,
    ground_truth_fields: gtFields,
    field_precision: ratio(correct, correct + wrong + spurious),
    field_recall: ratio(correct, gtFields),
    auto_accept_precision: ratio(autoCorrect, auto),
    auto_accept_coverage: ratio(auto, gtFields),
    silent_wrong_count: total((s) => s.silent_wrong),
    per_form: group((s) => s.form_family),
    per_quality: group((s) => s.quality),
    cost_micro_usd_total: costTotal,
    cost_micro_usd_per_doc: scores.length === 0 ? 0n : costTotal / BigInt(scores.length),
  };
}
