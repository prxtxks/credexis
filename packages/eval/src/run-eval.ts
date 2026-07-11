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

main().catch((err: unknown) => {
  console.error(`eval failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
