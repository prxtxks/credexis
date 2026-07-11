/**
 * CI schema checks (M2.7) — static, offline, run on every merge:
 *
 * 1. "Every new table has RLS" (standing order #6): every CREATE TABLE in
 *    the migration history must be matched by ENABLE ROW LEVEL SECURITY.
 *    A new table without RLS = failing CI, exactly as CLAUDE.md demands.
 * 2. Code ⇄ migrations closure: every table defined in the drizzle TS schema
 *    exists in migration SQL (drift the other way is caught by
 *    scripts/check-drift.mjs, which diffs against a generate run).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as dbSchema from "./index.js";

const drizzleDir = join(__dirname, "..", "..", "drizzle");
const allSql = readdirSync(drizzleDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
  .join("\n");

function matches(re: RegExp): Set<string> {
  const found = new Set<string>();
  for (const m of allSql.matchAll(re)) {
    const name = m[1];
    if (name) found.add(name.toLowerCase());
  }
  return found;
}

// drizzle emits: CREATE TABLE "documents" (…) — hand-written SQL may qualify.
const createdTables = matches(/create table (?:if not exists )?"?(?:public\.)?"?([a-z_]+)"?/gi);
const rlsEnabled = matches(/alter table (?:public\.)?"?([a-z_]+)"?\s+enable row level security/gi);
const withPolicies = matches(/create policy .+? on (?:public\.)?"?([a-z_]+)"?/gis);

describe("CI schema checks (M2.7)", () => {
  it("found a plausible number of tables (parser sanity)", () => {
    expect(createdTables.size).toBeGreaterThanOrEqual(19); // Blueprint §5 count
  });

  it("EVERY table created in migrations has RLS enabled (standing order #6)", () => {
    const missing = [...createdTables].filter((t) => !rlsEnabled.has(t));
    expect(missing, `tables without RLS: ${missing.join(", ")}`).toEqual([]);
  });

  it("every RLS-enabled application table has at least one policy (no dead-locked tables)", () => {
    // audit_log is deliberately trigger-written; it still has a SELECT policy.
    const missing = [...createdTables].filter((t) => !withPolicies.has(t));
    expect(missing, `RLS-enabled but zero policies: ${missing.join(", ")}`).toEqual([]);
  });

  it("every drizzle TS table exists in migration SQL (code ⇄ migrations closure)", () => {
    const tsTables = Object.values(dbSchema)
      .filter((v): v is PgTable => is(v, PgTable))
      .map((t) => getTableName(t).toLowerCase());
    expect(tsTables.length).toBeGreaterThanOrEqual(19);
    const missing = tsTables.filter((t) => !createdTables.has(t));
    expect(missing, `TS tables missing from migrations: ${missing.join(", ")}`).toEqual([]);
  });
});
