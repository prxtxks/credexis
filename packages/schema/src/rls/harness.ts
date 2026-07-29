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
 * Split SQL into statements, honouring dollar-quoted bodies (`$$ … $$`,
 * `$tag$ … $tag$`) and single-quoted literals. Splitting on a bare `;` is
 * NOT safe here: `raise exception 'live invite bound to %; revoke it before
 * changing the email'` yields a fragment starting with "revoke", which an
 * earlier version of this file executed as SQL. Skipping whole chunks that
 * contain `$$` is not safe either — 0001 defines functions and issues its
 * grants in the same chunk, so that silently dropped `revoke all on all
 * tables from anon`, leaving the harness MORE permissive than production.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let dollarTag: string | null = null;
  let inSingle = false;

  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        buf += sql[i++];
      }
      continue;
    }
    if (inSingle) {
      // '' is an escaped quote inside a literal, not a terminator.
      if (sql[i] === "'" && sql[i + 1] === "'") {
        buf += "''";
        i += 2;
        continue;
      }
      if (sql[i] === "'") inSingle = false;
      buf += sql[i++];
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      dollarTag = dollar[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }
    if (sql[i] === "'") {
      inSingle = true;
      buf += sql[i++];
      continue;
    }
    if (sql[i] === ";") {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += sql[i++];
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * Re-execute the GRANT/REVOKE statements from every migration, in journal
 * order, so migration intent wins over the blanket baseline above.
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
    // Strip line comments so a commented-out GRANT is never replayed.
    const cleaned = body
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n")
      .replaceAll("--> statement-breakpoint", "");

    for (const raw of splitStatements(cleaned)) {
      const stmt = raw.trim();
      if (!/^(grant|revoke)\s/i.test(stmt)) continue;
      await sql.unsafe(stmt);
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
