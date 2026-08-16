#!/usr/bin/env node
/**
 * Miss autopsy (M23): turn eval-output/misses-<row>.json into the
 * categorized, human-readable list recall work runs on. Read-only.
 *
 *   node packages/eval/dist/autopsy.js [--row consensus]
 *
 * Buckets:
 *   whole-doc   every GT field missed → structural (period, layout, split)
 *   null-gt     GT value is null (blank box) → measurement, not extraction
 *   scattered   individual identities → vocabulary / mapping
 *   wrong       extracted but value differs → the ones that matter most
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

interface DocMisses {
  id: string;
  form_family: string;
  missed: string[];
  wrong: { key: string; expected: string | null; got: string | null }[];
  uncovered?: string[];
}

function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = resolve(dir, "..");
    if (parent === dir) throw new Error("repo root not found");
    dir = parent;
  }
  return dir;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const i = process.argv.indexOf("--row");
  const row = i === -1 ? "consensus" : (process.argv[i + 1] ?? "consensus");
  const path = join(root, "eval-output", `misses-${row}.json`);
  if (!existsSync(path)) throw new Error(`${path} missing - run the bake-off first`);
  const docs = JSON.parse(await readFile(path, "utf8")) as DocMisses[];

  // Ground truth for null-vs-value classification.
  const gtNull = new Map<string, Set<string>>();
  const gtCount = new Map<string, number>();
  for (const d of docs) {
    const gtPath = join(root, "corpus", "ground-truth", `${d.id}.json`);
    if (!existsSync(gtPath)) continue;
    const gt = JSON.parse(await readFile(gtPath, "utf8")) as {
      fields: {
        registry_field_id?: string;
        taxonomy_node?: string;
        period: string;
        value_cents: string | null;
      }[];
    };
    gtCount.set(d.id, gt.fields.length);
    const nulls = new Set<string>();
    for (const f of gt.fields) {
      if (f.value_cents === null)
        nulls.add(`${f.registry_field_id ?? ""}|${f.taxonomy_node ?? ""}|${f.period}`);
    }
    gtNull.set(d.id, nulls);
  }

  let wholeDoc = 0;
  let nullGt = 0;
  let scattered = 0;
  let wrong = 0;
  const lines: string[] = [];
  for (const d of docs) {
    const total = gtCount.get(d.id) ?? 0;
    const nulls = gtNull.get(d.id) ?? new Set<string>();
    // Match ignoring the period-spelling detail: compare on field id + normalized period prefix.
    const isNull = (k: string) =>
      [...nulls].some(
        (n) => n.split("|").slice(0, 2).join("|") === k.split("|").slice(0, 2).join("|"),
      );
    if (d.missed.length > 0 && total > 0 && d.missed.length >= total - 1) {
      wholeDoc += d.missed.length;
      lines.push(
        `WHOLE-DOC  ${d.id} (${d.form_family}): ${d.missed.length}/${total} missed → structural`,
      );
      continue;
    }
    for (const k of d.missed) {
      if (isNull(k)) {
        nullGt += 1;
        lines.push(`NULL-GT    ${d.id}: ${k}`);
      } else {
        scattered += 1;
        lines.push(`SCATTERED  ${d.id}: ${k}`);
      }
    }
    for (const w of d.wrong) {
      wrong += 1;
      lines.push(`WRONG      ${d.id}: ${w.key}  expected=${w.expected} got=${w.got}`);
    }
  }
  console.log(
    `autopsy of ${row}: whole-doc ${wholeDoc} | null-gt ${nullGt} | scattered ${scattered} | wrong ${wrong}`,
  );
  console.log(lines.sort().join("\n"));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
