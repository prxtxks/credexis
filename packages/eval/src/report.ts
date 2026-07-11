/**
 * Eval report rendering + baseline regression gate (M1.4).
 *
 * Real-corpus metrics are THE scorecard. Synthetic-fixture metrics are a
 * harness wiring check only and are labeled as such everywhere (Iron Law #9:
 * synthetic never counts in accuracy claims).
 */

import type { MetricsSummary } from "./scorer.js";

export interface EvalReport {
  version: 1;
  generated_at: string;
  extractor: string;
  real: MetricsSummary | null;
  synthetic_harness_check: MetricsSummary | null;
}

/** Headline metrics kept in eval-baseline.json for regression comparison. */
export interface BaselineMetrics {
  field_precision: number | null;
  field_recall: number | null;
  auto_accept_precision: number | null;
  auto_accept_coverage: number | null;
  silent_wrong_count: number;
  documents: number;
}

export interface Baseline {
  version: 1;
  extractor: string;
  real: BaselineMetrics | null;
  synthetic_harness_check: BaselineMetrics | null;
}

export function toBaselineMetrics(m: MetricsSummary | null): BaselineMetrics | null {
  if (m === null) return null;
  return {
    field_precision: m.field_precision,
    field_recall: m.field_recall,
    auto_accept_precision: m.auto_accept_precision,
    auto_accept_coverage: m.auto_accept_coverage,
    silent_wrong_count: m.silent_wrong_count,
    documents: m.documents,
  };
}

export interface RegressionFinding {
  section: "real" | "synthetic_harness_check";
  metric: string;
  baseline: number | null;
  current: number | null;
  message: string;
}

/** Default tolerance: a metric may not drop more than 0.2pt below baseline. */
export const DEFAULT_TOLERANCE = 0.002;

function compareSection(
  section: "real" | "synthetic_harness_check",
  base: BaselineMetrics | null,
  cur: BaselineMetrics | null,
  tolerance: number,
): RegressionFinding[] {
  const findings: RegressionFinding[] = [];
  if (base === null) return findings; // nothing to regress against
  if (cur === null) {
    findings.push({
      section,
      metric: "documents",
      baseline: base.documents,
      current: null,
      message: `${section}: baseline had ${base.documents} documents, current run has none`,
    });
    return findings;
  }
  const rates: Array<keyof BaselineMetrics> = [
    "field_precision",
    "field_recall",
    "auto_accept_precision",
    "auto_accept_coverage",
  ];
  for (const metric of rates) {
    const b = base[metric];
    const c = cur[metric];
    if (typeof b === "number" && (c === null || (typeof c === "number" && c < b - tolerance))) {
      findings.push({
        section,
        metric,
        baseline: b,
        current: typeof c === "number" ? c : null,
        message: `${section}.${metric} regressed: ${c === null ? "null" : c.toFixed(4)} < baseline ${b.toFixed(4)} − ${tolerance}`,
      });
    }
  }
  if (cur.silent_wrong_count > base.silent_wrong_count) {
    findings.push({
      section,
      metric: "silent_wrong_count",
      baseline: base.silent_wrong_count,
      current: cur.silent_wrong_count,
      message: `${section}.silent_wrong_count rose to ${cur.silent_wrong_count} (baseline ${base.silent_wrong_count})`,
    });
  }
  return findings;
}

/** Compare a report against the committed baseline. Empty array = no regression. */
export function findRegressions(
  baseline: Baseline,
  report: EvalReport,
  tolerance: number = DEFAULT_TOLERANCE,
): RegressionFinding[] {
  const findings = [
    ...compareSection("real", baseline.real, toBaselineMetrics(report.real), tolerance),
    ...compareSection(
      "synthetic_harness_check",
      baseline.synthetic_harness_check,
      toBaselineMetrics(report.synthetic_harness_check),
      tolerance,
    ),
  ];
  // The cardinal sin is absolute, not relative: ANY silent wrong on the real
  // corpus fails, regardless of what the baseline says.
  if (report.real !== null && report.real.silent_wrong_count > 0) {
    findings.push({
      section: "real",
      metric: "silent_wrong_count",
      baseline: 0,
      current: report.real.silent_wrong_count,
      message: `real.silent_wrong_count = ${report.real.silent_wrong_count} — wrong values passed review (must be 0)`,
    });
  }
  return findings;
}

/** JSON.stringify with bigint → string (costs are bigint micro-USD). */
export function toJson(value: unknown): string {
  return (
    JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n"
  );
}

function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(2)}%`;
}

function usd(micro: bigint): string {
  const cents = micro / 10000n;
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function sectionMd(title: string, m: MetricsSummary): string {
  const forms = Object.entries(m.per_form)
    .map(([k, v]) => `| ${k} | ${v.fields} | ${pct(v.precision)} | ${pct(v.recall)} |`)
    .join("\n");
  const qualities = Object.entries(m.per_quality)
    .map(([k, v]) => `| ${k} | ${v.fields} | ${pct(v.precision)} | ${pct(v.recall)} |`)
    .join("\n");
  return `## ${title}

| Metric | Value |
| --- | --- |
| Documents | ${m.documents} |
| Ground-truth fields | ${m.ground_truth_fields} |
| Field precision | ${pct(m.field_precision)} |
| Field recall | ${pct(m.field_recall)} |
| Auto-accept precision | ${pct(m.auto_accept_precision)} |
| Auto-accept coverage | ${pct(m.auto_accept_coverage)} |
| **Silent wrong (must be 0)** | **${m.silent_wrong_count}** |
| Cost total / per doc | ${usd(m.cost_micro_usd_total)} / ${usd(m.cost_micro_usd_per_doc)} |

### Per form
| Form | Fields | Precision | Recall |
| --- | --- | --- | --- |
${forms}

### Per quality
| Quality | Fields | Precision | Recall |
| --- | --- | --- | --- |
${qualities}
`;
}

/** Render the markdown report. */
export function toMarkdown(report: EvalReport): string {
  const real =
    report.real === null
      ? "## Real corpus\n\n_No real documents in the corpus yet (M1.3 labeling in progress). " +
        "No accuracy claim can be made._\n"
      : sectionMd("Real corpus — THE scorecard", report.real);
  const synth =
    report.synthetic_harness_check === null
      ? ""
      : sectionMd(
          "Synthetic fixtures — harness wiring check ONLY (never an accuracy claim)",
          report.synthetic_harness_check,
        );
  return `# Eval report

- Generated: ${report.generated_at}
- Extractor under evaluation: \`${report.extractor}\`

${real}
${synth}`;
}
