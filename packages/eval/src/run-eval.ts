#!/usr/bin/env node
/**
 * `pnpm eval` entry (M1.4). Runs the configured extractor over the corpus,
 * writes eval-output/eval-report.{json,md}, and compares headline metrics
 * against the committed eval-baseline.json — any regression beyond tolerance
 * exits non-zero (CI enforces).
 *
 *   --extractor perfect|noisy   (default: perfect; also EVAL_EXTRACTOR env)
 *   --corpus-dir <dir>          (default: corpus, resolved from repo root)
 *   --update-baseline           rewrite eval-baseline.json from this run
 *
 * Real corpus documents are the scorecard; synthetic fixtures are scored
 * separately as a harness wiring check and NEVER merged into accuracy claims.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCorpus } from "./corpus.js";
import { MOCK_EXTRACTORS } from "./mock-extractors.js";
import { buildRealExtractors, canonPeriod } from "./real-extractors.js";
import {
  findRegressions,
  toBaselineMetrics,
  toJson,
  toMarkdown,
  type Baseline,
  type EvalReport,
} from "./report.js";
import { scoreDocument, summarize } from "./scorer.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const v = i === -1 ? undefined : process.argv[i + 1];
  return v?.startsWith("--") === false ? v : undefined;
}

/** Walk up from cwd to the pnpm workspace root (turbo runs us in the package dir). */
function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = resolve(dir, "..");
    if (parent === dir) throw new Error("could not locate repo root (pnpm-workspace.yaml)");
    dir = parent;
  }
  return dir;
}

async function main(): Promise<void> {
  const root = repoRoot();
  if (process.argv.includes("--bake-off")) return bakeOff(root);
  const extractorName = arg("--extractor") ?? process.env["EVAL_EXTRACTOR"] ?? "perfect";
  const extractor = MOCK_EXTRACTORS[extractorName];
  if (!extractor) throw new Error(`unknown extractor "${extractorName}" (perfect|noisy)`);

  const corpusDir = resolve(root, arg("--corpus-dir") ?? "corpus");
  const docs = await loadCorpus(corpusDir);
  const real = docs.filter((d) => !d.groundTruth.synthetic);
  const synthetic = docs.filter((d) => d.groundTruth.synthetic);

  const score = async (subset: typeof docs) => {
    const scores = [];
    for (const doc of subset) {
      scores.push(scoreDocument(doc.groundTruth, await extractor.extract(doc)));
    }
    return scores;
  };

  const report: EvalReport = {
    version: 1,
    generated_at: new Date().toISOString(),
    extractor: `${extractor.name}@${extractor.version}`,
    real: real.length > 0 ? summarize(await score(real)) : null,
    synthetic_harness_check: synthetic.length > 0 ? summarize(await score(synthetic)) : null,
  };

  const outDir = join(root, "eval-output");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "eval-report.json"), toJson(report), "utf8");
  await writeFile(join(outDir, "eval-report.md"), toMarkdown(report), "utf8");
  console.log(`eval: ${docs.length} docs (${real.length} real, ${synthetic.length} synthetic)`);
  console.log(`  report → eval-output/eval-report.{json,md}`);

  const baselinePath = join(root, "eval-baseline.json");
  if (process.argv.includes("--update-baseline")) {
    const baseline: Baseline = {
      version: 1,
      extractor: report.extractor,
      real: toBaselineMetrics(report.real),
      synthetic_harness_check: toBaselineMetrics(report.synthetic_harness_check),
    };
    await writeFile(baselinePath, toJson(baseline), "utf8");
    console.log(`  baseline updated → eval-baseline.json`);
    return;
  }

  if (!existsSync(baselinePath)) {
    throw new Error(
      "eval-baseline.json missing — run `pnpm eval -- --update-baseline` once and commit it",
    );
  }
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as Baseline;
  const regressions = findRegressions(baseline, report);
  if (regressions.length > 0) {
    console.error(`EVAL REGRESSION (${regressions.length}):`);
    for (const r of regressions) console.error(`  - ${r.message}`);
    process.exit(1);
  }
  console.log("  no regression vs eval-baseline.json");
}

/**
 * M3.4 vendor bake-off: every REAL extractor over the REAL corpus, live
 * vendor calls (RUN_LIVE_VENDOR_TESTS=1 required — this costs money).
 * Produces eval-output/bake-off-report.md; never touches the CI baseline.
 */
async function bakeOff(root: string): Promise<void> {
  if (process.env["RUN_LIVE_VENDOR_TESTS"] !== "1") {
    throw new Error("--bake-off makes LIVE vendor calls; set RUN_LIVE_VENDOR_TESTS=1");
  }
  const rows = buildRealExtractors({
    REDUCTO_API_KEY: process.env["REDUCTO_API_KEY"],
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: process.env["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"],
    AZURE_DOCUMENT_INTELLIGENCE_KEY: process.env["AZURE_DOCUMENT_INTELLIGENCE_KEY"],
    ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"],
  });
  const only = arg("--only");
  const corpusDir = resolve(root, arg("--corpus-dir") ?? "corpus");
  const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
  const docs = (await loadCorpus(corpusDir))
    .filter((d) => !d.groundTruth.synthetic && d.pdfPath !== null)
    .slice(0, limit === Infinity ? undefined : limit);
  // Period display suffixes are canonicalized on BOTH sides (formatting
  // only; values untouched — Iron Law #9).
  const canonDocs = docs.map((d) => ({
    ...d,
    groundTruth: {
      ...d.groundTruth,
      fields: d.groundTruth.fields.map((f) => ({ ...f, period: canonPeriod(f.period) })),
    },
  }));

  const sections: string[] = [];
  const summaryLines: string[] = [
    "| Extractor | Docs | Fields | Precision | Recall | Auto-accept prec | Silent wrong | Cost |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [key, extractor] of Object.entries(rows)) {
    if (only && key !== only) continue;
    console.log(`bake-off: running ${key} over ${canonDocs.length} docs…`);
    const scores = [];
    for (const doc of canonDocs) {
      try {
        const result = await extractor.extract(doc);
        if (result.fields.length === 0) {
          console.log(`  ${doc.groundTruth.id}: unsupported/empty — skipped`);
          continue;
        }
        const openSet = ["PNL", "BALANCE_SHEET", "DEBT_SCHEDULE"].includes(
          doc.groundTruth.form_family,
        );
        scores.push(scoreDocument(doc.groundTruth, result, { openSet }));
        console.log(`  ${doc.groundTruth.id}: ${result.fields.length} fields`);
      } catch (e) {
        console.log(`  ${doc.groundTruth.id}: ERROR ${String((e as Error).message).slice(0, 120)}`);
      }
    }
    if (scores.length === 0) continue;
    // Field-level autopsy: recall work needs to know WHICH identities were
    // missed, not just how many (M23).
    await mkdir(join(root, "eval-output"), { recursive: true });
    await writeFile(
      join(root, "eval-output", `misses-${key}.json`),
      JSON.stringify(
        scores.map((sc) => ({
          id: sc.id,
          form_family: sc.form_family,
          missed: sc.detail.missed_keys,
          wrong: sc.detail.wrong_values,
          uncovered: sc.detail.uncovered_keys,
        })),
        null,
        2,
      ),
      "utf8",
    );
    const s = summarize(scores);
    const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(2)}%`);
    const usd = (m: bigint) => `$${(Number(m) / 1e6).toFixed(2)}`;
    summaryLines.push(
      `| ${extractor.name} | ${scores.length} | ${s.ground_truth_fields} | ${pct(s.field_precision)} | ${pct(s.field_recall)} | ${pct(s.auto_accept_precision)} | ${s.silent_wrong_count} | ${usd(s.cost_micro_usd_total)} |`,
    );
    sections.push(
      `## ${extractor.name}\n\n${toMarkdown({
        version: 1,
        generated_at: new Date().toISOString(),
        extractor: `${extractor.name}@${extractor.version}`,
        real: s,
        synthetic_harness_check: null,
      })}`,
    );
  }

  const outDir = join(root, "eval-output");
  await mkdir(outDir, { recursive: true });
  const md = `# Vendor bake-off (M3.4) — real corpus, live calls\n\nGenerated ${new Date().toISOString()}\n\n${summaryLines.join("\n")}\n\n${sections.join("\n\n")}\n`;
  await writeFile(join(outDir, "bake-off-report.md"), md, "utf8");
  console.log("bake-off report → eval-output/bake-off-report.md");
}

main().catch((err: unknown) => {
  console.error(`eval failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
