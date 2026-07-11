#!/usr/bin/env node
/**
 * Migration drift check (M2.7): the drizzle TS schema and the committed
 * migrations must describe the same database. Runs `drizzle-kit generate`
 * against a COPY of ./drizzle — if it would emit a new migration, someone
 * changed src/db/* without generating one, and CI goes red.
 *
 * Offline by design (generate never connects); requires `pnpm run build`
 * first (drizzle.config reads dist/). The work dir must be RELATIVE:
 * drizzle-kit prefixes --out with "./" and silently exits 0 on the resulting
 * ENOENT for absolute paths (verified against a planted schema change).
 */

import { execSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const pkgRoot = new URL("..", import.meta.url).pathname;
const source = join(pkgRoot, "drizzle");
const WORK_REL = ".drift-check"; // gitignored
const work = join(pkgRoot, WORK_REL);

const sqlFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith(".sql"));

rmSync(work, { recursive: true, force: true });
try {
  cpSync(source, work, { recursive: true });
  const before = sqlFiles(work).length;

  // Passing any CLI flag makes drizzle-kit ignore drizzle.config.ts, so every
  // param is explicit (keep in sync with drizzle.config.ts).
  const out = execSync(
    `pnpm exec drizzle-kit generate --dialect postgresql --schema ./dist/db/index.js ` +
      `--out ${WORK_REL} --name drift-probe`,
    { cwd: pkgRoot, encoding: "utf8" },
  );
  // Belt & braces: drizzle-kit can exit 0 on internal errors.
  if (/error|ENOENT/i.test(out)) {
    console.error("✗ drift check could not run drizzle-kit cleanly:\n" + out);
    process.exit(1);
  }

  const after = sqlFiles(work);
  if (after.length > before) {
    const fresh = after.filter((f) => f.includes("drift-probe"));
    console.error("✗ MIGRATION DRIFT: src/db/* changed without a generated migration.");
    console.error(`  drizzle-kit would emit: ${fresh.join(", ")}`);
    console.error("  Fix: pnpm --filter @credexis/schema db:generate, review, commit.");
    process.exit(1);
  }
  console.log(`✓ no migration drift (${before} migrations match the schema)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
