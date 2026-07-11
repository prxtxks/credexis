#!/usr/bin/env node
/**
 * Token-authenticated migration runner (`pnpm db:migrate:api`).
 *
 * Applies drizzle migrations via the Supabase Management API query endpoint
 * using only SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF — no database
 * password, no dashboard login. It writes the SAME `drizzle.__drizzle_migrations`
 * tracking rows the native drizzle migrator writes (schema `drizzle`, columns
 * hash text + created_at bigint, hash = sha256 of the raw .sql file), so the
 * two runners are interchangeable: whichever applied a migration, the other
 * sees it as done.
 *
 * Each migration is wrapped in a single BEGIN/COMMIT sent as one request, so
 * it applies atomically.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface JournalEntry {
  tag: string;
  when: number;
}

const MIGRATIONS_DIR = process.env["MIGRATIONS_DIR"] ?? "drizzle";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (source .env.local)`);
  return v;
}

async function runSql(ref: string, token: string, query: string): Promise<unknown> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    // Body may contain SQL text but never a secret; safe to surface.
    throw new Error(`query failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function main(): Promise<void> {
  const ref = requireEnv("SUPABASE_PROJECT_REF");
  const token = requireEnv("SUPABASE_ACCESS_TOKEN");

  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };

  // Ensure tracking table (matches drizzle's DDL exactly).
  await runSql(
    ref,
    token,
    `CREATE SCHEMA IF NOT EXISTS "drizzle";
     CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);`,
  );

  const applied = (await runSql(
    ref,
    token,
    `SELECT created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1;`,
  )) as Array<{ created_at: string | number }>;
  const lastApplied = applied[0] ? Number(applied[0].created_at) : -1;

  let count = 0;
  for (const entry of journal.entries) {
    if (entry.when <= lastApplied) continue;
    const raw = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(raw).digest("hex");
    const body = raw.split("--> statement-breakpoint").join("\n");
    const query = [
      "BEGIN;",
      body,
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${hash}', ${entry.when});`,
      "COMMIT;",
    ].join("\n");
    await runSql(ref, token, query);
    console.log(`applied ${entry.tag}`);
    count += 1;
  }
  console.log(count === 0 ? "no pending migrations" : `${count} migration(s) applied`);
}

main().catch((err: unknown) => {
  console.error(`migrate-api failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
