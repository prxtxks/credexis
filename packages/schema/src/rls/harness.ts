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
