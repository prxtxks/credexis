#!/usr/bin/env node
/**
 * Signal-sweep CLI (corpus-1).
 *
 *   signal-sweep download [--dir corpus/signal-sweep]
 *       fetch the public IRS sweep corpus (official form revisions + MeF
 *       ATS filled scenarios) - idempotent, gitignored
 *   signal-sweep run [--dir corpus/signal-sweep]
 *       run the deterministic detector over every downloaded page; writes
 *       sweep-report.json; exits 1 on any confident wrong-family hit
 *
 * Run from the repo root:  pnpm --filter @credexis/eval signals -- download
 */

import { resolve } from "node:path";
import { downloadSweepCorpus } from "./download.js";
import { runSweep, writeSweepReport } from "./sweep.js";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function main(): Promise<void> {
  // pnpm runs package scripts from the package dir; INIT_CWD is where the
  // user actually invoked from (the repo root), which anchors the default.
  const [cmd, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
  const dir = resolve(
    process.env["INIT_CWD"] ?? process.cwd(),
    getFlag(rest, "--dir") ?? "corpus/signal-sweep",
  );

  if (cmd === "download") {
    const results = await downloadSweepCorpus(dir);
    const failed = results.filter((r) => r.status === "failed");
    for (const r of results) {
      console.log(`  ${r.status.padEnd(10)} ${r.id}${r.error ? `  (${r.error})` : ""}`);
    }
    console.log(
      `signal-sweep corpus: ${results.length - failed.length}/${results.length} present in ${dir}`,
    );
    if (failed.length > 0) process.exit(1);
    return;
  }

  if (cmd === "run") {
    const report = await runSweep(dir);
    const path = await writeSweepReport(report, dir);
    const wrong = report.findings.filter((f) => f.verdict === "wrong");
    const suspect = report.findings.filter((f) => f.verdict === "suspect");
    console.log(
      `swept ${report.docs} docs / ${report.pages} pages: ` +
        `${report.classified} classified, ${report.abstained} abstained`,
    );
    for (const f of report.findings) {
      console.log(
        `  [${f.verdict}] ${f.doc} p${f.page} → ${f.family}@${f.confidence} ` +
          `(${f.matched.join(",")})  "${f.excerpt.slice(0, 80)}"`,
      );
    }
    console.log(`report → ${path}`);
    console.log(`${wrong.length} wrong (hard failures), ${suspect.length} suspect (review)`);
    if (wrong.length > 0) process.exit(1);
    return;
  }

  console.error("usage: signal-sweep <download|run> [--dir corpus/signal-sweep]");
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
