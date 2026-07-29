/**
 * RLS integration harness (M12.0, synthesis GAP list): runs the REAL
 * migrations against a throwaway Postgres (CI service container) and
 * exercises the policies as impersonated users. This is the behavioral
 * proof the static schema checks can't give — every new policy must land
 * with a scenario here (standing rule, synthesis §4).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Shim first (roles/auth/storage/grants), then the real migrations. */
export async function prepareDatabase(sql: Sql): Promise<void> {
  await sql.unsafe(readFileSync(join(HERE, "shim.sql"), "utf8"));
  await migrate(drizzle(sql), { migrationsFolder: join(HERE, "../../drizzle") });
  // Reconcile grants to the live Supabase END-STATE. On a real project the
  // platform's default privileges grant API roles access to every new
  // table/function and the migrations then adjust selectively; default
  // privileges proved unreliable under the harness runner, so the baseline
  // is (re)applied explicitly here.
  await sql.unsafe(`
    grant all on all tables in schema public to authenticated, service_role;
    grant usage, select on all sequences in schema public to authenticated, service_role;
    grant execute on all functions in schema public to authenticated;
    revoke all on all tables in schema public from anon;
  `);

  // …then REPLAY every GRANT/REVOKE the migrations themselves issued, in
  // order, so migration intent wins — exactly as it does in production,
  // where nothing runs after them.
  //
  // This used to be a hand-maintained list, which silently defeated the
  // thing it was meant to test: the blanket `grant all` above re-granted
  // table-level UPDATE and wiped 0026's column-level grant on
  // borrower_invites, so the harness reported a broker COULD re-point a
  // live invite (production could not). A hand-maintained list fails
  // exactly when someone adds a grant and forgets — i.e. when it matters.
  // Replaying from the migration files is self-maintaining.
  await replayGrants(sql);
}

/**
 * Re-execute the GRANT/REVOKE statements from every migration, in journal
 * order. Only privilege statements are replayed — they are idempotent and
 * never contain `$$` bodies, so simple statement splitting is safe.
 */
async function replayGrants(sql: Sql): Promise<void> {
  const dir = join(HERE, "../../drizzle");
  const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };

  for (const { tag } of journal.entries) {
    const file = join(dir, `${tag}.sql`);
    let body: string;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const chunk of body.split("--> statement-breakpoint")) {
      // Strip line comments so a commented-out GRANT is never replayed.
      const cleaned = chunk
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
      for (const raw of cleaned.split(";")) {
        const stmt = raw.trim();
        if (!/^(grant|revoke)\s/i.test(stmt)) continue;
        await sql.unsafe(stmt);
      }
    }
  }
}

/**
 * Run `fn` inside a transaction impersonating a signed-in user (or anon
 * when uid is null): sets the JWT-claims GUC auth.uid() reads, then drops
 * to the PostgREST role so grants + RLS apply exactly as in production.
 * The transaction is ROLLED BACK unless fn's writes should persist —
 * callers that mutate must verify effects with the superuser connection
 * inside `fn` semantics; we deliberately COMMIT (postgres.js begin()
 * commits on success) so allowed writes are observable.
 */
export async function asUser<T>(
  sql: Sql,
  uid: string | null,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    if (uid !== null) {
      await tx.unsafe("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role: "authenticated" }),
      ]);
      await tx.unsafe("set local role authenticated");
    } else {
      await tx.unsafe("set local role anon");
    }
    return await fn(tx as unknown as Sql);
  })) as T;
}

/** Assert a statement is rejected by grants/RLS (throws) — returns the error. */
export async function expectDenied(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the statement to be DENIED, but it succeeded");
}
