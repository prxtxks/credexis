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
  // table/function and the migrations then revoke selectively; default
  // privileges proved unreliable under the harness runner, so the same
  // end-state is (re)applied explicitly: authenticated gets blanket table
  // + function access (RLS does the gating), anon gets nothing, and the
  // migrations' explicit revokes are re-run LAST so they win, exactly as
  // they do in production.
  await sql.unsafe(`
    grant all on all tables in schema public to authenticated, service_role;
    grant usage, select on all sequences in schema public to authenticated, service_role;
    grant execute on all functions in schema public to authenticated;
    revoke all on all tables in schema public from anon;
    revoke update, delete on public.audit_log from anon, authenticated, service_role;
    revoke all on function public.create_organization(text, org_kind) from public, anon;
    revoke execute on function public.current_tenant_id() from public, anon;
    revoke execute on function public.current_user_role() from public, anon;
    revoke all on function public.accept_invite(text) from public, anon;
    revoke all on function public.notify_tier(uuid,int,notification_kind,text,text,text,uuid,text) from public, anon, authenticated;
    revoke all on function public.update_own_profile(text, boolean) from public, anon;
  `);
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
