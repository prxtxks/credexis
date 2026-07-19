#!/usr/bin/env node
/**
 * M7.7 / Iron Law #3 guard: no metric or money arithmetic anywhere in
 * apps/web — the engine computes, the app reshapes and renders. Scans for
 * arithmetic operators adjacent to money/metric identifiers and fails the
 * build on any hit. Runs in CI next to lint.
 *
 * (packages/engine and packages/shared are covered separately by the
 * type-aware money lint rule; this greps the app, where most code is not
 * typed as Cents and the lint rule cannot see it.)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "apps", "web", "src");

const IDENT =
  "(?:valueCents|value_cents|amountCents|amount_cents|ratioMantissa|ratio_mantissa|costMicroUsd|cost_micro_usd|mantissa|cfads|ebitda|dscr\\w*|sde)";
// Arithmetic on either side of a money/metric identifier. `-` before an
// identifier only counts as binary when something value-like precedes it.
const PATTERNS = [
  new RegExp(`\\b${IDENT}\\b\\s*[+*/%-]\\s*[\\w$(]`, "i"),
  new RegExp(`[\\w$)]\\s*[+*/%]\\s*\\b${IDENT}\\b`, "i"),
];

/** Lines where the identifier is string/display work, not math. */
const SAFE_LINE = /String\(|\.toString\(|`|throw|Error\(|\/\/|^\s*\*/;

const violations = [];

function scan(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      scan(path);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.ts$/.test(name)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (SAFE_LINE.test(line)) return;
      if (PATTERNS.some((p) => p.test(line))) {
        violations.push(`${path}:${i + 1}  ${line.trim()}`);
      }
    });
  }
}

scan(ROOT);

if (violations.length > 0) {
  console.error("✗ metric/money arithmetic found in apps/web (Iron Law #3 — engine only):\n");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log("✓ no client math on metric/money fields in apps/web");
