/**
 * RLS isolation integration test (M2.2 / M2 exit gate): two seeded tenants
 * cannot see each other's rows — proven against the LIVE database via the
 * Supabase Management API, impersonating users with
 * `set local role authenticated` + `request.jwt.claims`.
 *
 * Runs only when SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF are present
 * (local dev; skipped in CI until a CI secret is provisioned). All seeded
 * rows are removed in cleanup; user-impersonation statements run inside
 * rolled-back transactions.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const token = process.env["SUPABASE_ACCESS_TOKEN"];
const ref = process.env["SUPABASE_PROJECT_REF"];
const live = Boolean(token && ref);

/** Deterministic test UUIDs (cleaned up before and after). */
const T = {
  packId: "00000000-0000-4000-a000-000000000001",
  tenantA: "00000000-0000-4000-a000-00000000000a",
  tenantB: "00000000-0000-4000-a000-00000000000b",
  userA: "00000000-0000-4000-a000-0000000000aa",
  userB: "00000000-0000-4000-a000-0000000000bb",
  viewerA: "00000000-0000-4000-a000-0000000000ac",
  dealA: "00000000-0000-4000-a000-0000000000da",
  dealB: "00000000-0000-4000-a000-0000000000db",
};

async function runSql(query: string): Promise<{ ok: boolean; body: unknown }> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { ok: res.ok, body };
}

/** Run statements impersonating a signed-in user, inside a rolled-back tx. */
function asUser(userId: string, statements: string): string {
  return [
    "begin;",
    "set local role authenticated;",
    `set local request.jwt.claims to '{"sub":"${userId}","role":"authenticated"}';`,
    statements,
    "rollback;",
  ].join("\n");
}

const CLEANUP = `
  delete from public.deals where id in ('${T.dealA}','${T.dealB}');
  delete from public.profiles where id in ('${T.userA}','${T.userB}','${T.viewerA}');
  delete from public.tenants where id in ('${T.tenantA}','${T.tenantB}');
  delete from public.policy_packs where id = '${T.packId}';
`;

const SEED = `
  insert into public.policy_packs (id, version, effective_date, rules)
    values ('${T.packId}', 'test-pack-rls', '2026-03-01', '{}');
  insert into public.tenants (id, name) values
    ('${T.tenantA}', 'Tenant A'), ('${T.tenantB}', 'Tenant B');
  insert into public.profiles (id, tenant_id, email, role) values
    ('${T.userA}', '${T.tenantA}', 'a@test.local', 'underwriter'),
    ('${T.viewerA}', '${T.tenantA}', 'viewer@test.local', 'viewer'),
    ('${T.userB}', '${T.tenantB}', 'b@test.local', 'underwriter');
  insert into public.deals (id, tenant_id, name, type, policy_pack_id) values
    ('${T.dealA}', '${T.tenantA}', 'Deal A', 'business_acquisition', '${T.packId}'),
    ('${T.dealB}', '${T.tenantB}', 'Deal B', 'working_capital', '${T.packId}');
`;

describe.skipIf(!live)("RLS isolation (live database)", () => {
  beforeAll(async () => {
    await runSql(CLEANUP); // idempotent pre-clean
    const seeded = await runSql(SEED);
    expect(seeded.ok, JSON.stringify(seeded.body)).toBe(true);
  }, 30000);

  afterAll(async () => {
    const cleaned = await runSql(CLEANUP);
    expect(cleaned.ok).toBe(true);
  }, 30000);

  it("every public table has RLS enabled", async () => {
    const r = await runSql(
      `select count(*) as missing from pg_tables t
       where schemaname='public'
         and not exists (select 1 from pg_class c
           join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname=t.tablename and c.relrowsecurity);`,
    );
    expect((r.body as Array<{ missing: number }>)[0]?.missing).toBe(0);
  });

  it("tenant A sees only its own deals and tenant row", async () => {
    const r = await runSql(
      asUser(
        T.userA,
        `select (select json_agg(name order by name) from public.deals) as deals,
                (select json_agg(name order by name) from public.tenants) as tenants;`,
      ),
    );
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const row = (r.body as Array<{ deals: string[]; tenants: string[] }>)[0]!;
    expect(row.deals).toEqual(["Deal A"]);
    expect(row.tenants).toEqual(["Tenant A"]);
  });

  it("tenant B sees only its own deals (the mirror image)", async () => {
    const r = await runSql(
      asUser(T.userB, `select json_agg(name order by name) as deals from public.deals;`),
    );
    const row = (r.body as Array<{ deals: string[] }>)[0]!;
    expect(row.deals).toEqual(["Deal B"]);
  });

  it("tenant A CANNOT insert a deal into tenant B (with check violation)", async () => {
    const r = await runSql(
      asUser(
        T.userA,
        `insert into public.deals (tenant_id, name, type, policy_pack_id)
         values ('${T.tenantB}', 'Smuggled', 'refinance', '${T.packId}');`,
      ),
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.body)).toMatch(/row-level security/i);
  });

  it("underwriter CAN insert into own tenant (rolled back)", async () => {
    const r = await runSql(
      asUser(
        T.userA,
        `insert into public.deals (tenant_id, name, type, policy_pack_id)
         values ('${T.tenantA}', 'Legit', 'refinance', '${T.packId}');
         select count(*) as n from public.deals where name='Legit';`,
      ),
    );
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    expect((r.body as Array<{ n: number }>)[0]?.n).toBe(1);
  });

  it("viewer CANNOT insert a deal even in their own tenant", async () => {
    const r = await runSql(
      asUser(
        T.viewerA,
        `insert into public.deals (tenant_id, name, type, policy_pack_id)
         values ('${T.tenantA}', 'Viewer Write', 'refinance', '${T.packId}');`,
      ),
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.body)).toMatch(/row-level security/i);
  });

  it("cross-tenant profile reads are blocked", async () => {
    const r = await runSql(
      asUser(T.userA, `select json_agg(email order by email) as emails from public.profiles;`),
    );
    const row = (r.body as Array<{ emails: string[] }>)[0]!;
    expect(row.emails).toEqual(["a@test.local", "viewer@test.local"]);
  });

  it("anon role cannot read application tables at all", async () => {
    const r = await runSql(
      `begin; set local role anon; select count(*) from public.deals; rollback;`,
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.body)).toMatch(/permission denied/i);
  });

  it("audit_log is append-only: UPDATE is denied even for authenticated", async () => {
    const r = await runSql(
      asUser(T.userA, `update public.audit_log set action='tamper' where true;`),
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.body)).toMatch(/permission denied/i);
  });

  it("global reference data stays readable (policy packs)", async () => {
    const r = await runSql(
      asUser(
        T.userA,
        `select count(*) as n from public.policy_packs where version='test-pack-rls';`,
      ),
    );
    expect((r.body as Array<{ n: number }>)[0]?.n).toBe(1);
  });
});
