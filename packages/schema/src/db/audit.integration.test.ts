/**
 * Audit log writer integration test (M2.5 + half of the M2 exit gate):
 * "audit log captures a fact override" — proven against the LIVE database.
 *
 * Every scenario runs inside one rolled-back transaction: seed the fact
 * spine as postgres, switch to an impersonated user, mutate facts, RESET
 * ROLE, and read audit_log — the trigger rows are visible inside the tx and
 * vanish with the rollback. Nothing persists.
 */

import { describe, expect, it } from "vitest";

const token = process.env["SUPABASE_ACCESS_TOKEN"];
const ref = process.env["SUPABASE_PROJECT_REF"];
const live = Boolean(token && ref);

const T = {
  packId: "00000000-0000-4000-c000-000000000001",
  tenant: "00000000-0000-4000-c000-00000000000a",
  underwriter: "00000000-0000-4000-c000-0000000000aa",
  deal: "00000000-0000-4000-c000-0000000000da",
  entity: "00000000-0000-4000-c000-0000000000ea",
  period: "00000000-0000-4000-c000-0000000000fa",
  fact: "00000000-0000-4000-c000-0000000000f1",
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

/** Everything a fact needs to exist, seeded as postgres (rolled back later). */
const SEED_SPINE = `
  insert into public.policy_packs (id, version, effective_date, rules)
    values ('${T.packId}', 'test-pack-audit', '2026-03-01', '{}');
  insert into public.tenants (id, name) values ('${T.tenant}', 'Audit Tenant');
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at)
    values ('${T.underwriter}', '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'audit-uw@test.local', '', now(), now(), now());
  insert into public.profiles (id, tenant_id, role, email)
    values ('${T.underwriter}', '${T.tenant}', 'underwriter', 'audit-uw@test.local');
  insert into public.deals (id, tenant_id, name, type, policy_pack_id)
    values ('${T.deal}', '${T.tenant}', 'Audit Deal', 'business_acquisition', '${T.packId}');
  insert into public.entities (id, tenant_id, deal_id, kind, name)
    values ('${T.entity}', '${T.tenant}', '${T.deal}', 'applicant', 'Audit Co');
  insert into public.periods (id, tenant_id, entity_id, kind, start_date, end_date, label)
    values ('${T.period}', '${T.tenant}', '${T.entity}', 'fiscal_year',
      '2024-01-01', '2024-12-31', 'FY2024');
  insert into public.taxonomy_nodes (key, label, statement)
    values ('test.audit.net_income', 'Net income (audit test)', 'income_statement')
    on conflict (key) do nothing;
`;

const AS_UNDERWRITER = `
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"${T.underwriter}","role":"authenticated"}';
`;

const INSERT_FACT = `
  insert into public.facts (id, tenant_id, deal_id, entity_id, period_id,
      taxonomy_node_key, value_cents, method, status, created_by)
    values ('${T.fact}', '${T.tenant}', '${T.deal}', '${T.entity}', '${T.period}',
      'test.audit.net_income', 12500000, 'consensus', 'suggested', '${T.underwriter}');
`;

/** The override: exactly what the M2 exit gate asks the audit log to capture. */
const OVERRIDE_FACT = `
  update public.facts
    set status = 'overridden', original_value_cents = value_cents,
        value_cents = 13000000
    where id = '${T.fact}';
`;

describe.skipIf(!live)("Audit log writer (live database)", () => {
  it("captures a fact insert + override with actor and before/after", async () => {
    const res = await runSql(
      [
        "begin;",
        SEED_SPINE,
        AS_UNDERWRITER,
        INSERT_FACT,
        OVERRIDE_FACT,
        "reset role;",
        `select action, actor_id as actor, table_name, row_id,
                before->>'status' as before_status, after->>'status' as after_status,
                before->>'value_cents' as before_cents, after->>'value_cents' as after_cents
           from public.audit_log where row_id = '${T.fact}' order by id;`,
        "rollback;",
      ].join("\n"),
    );
    expect(res.ok, JSON.stringify(res.body)).toBe(true);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);

    const [ins, upd] = rows;
    expect(ins?.["action"]).toBe("INSERT");
    expect(ins?.["actor"]).toBe(T.underwriter); // who
    expect(ins?.["table_name"]).toBe("facts"); // what
    expect(ins?.["before_status"]).toBeNull();
    expect(ins?.["after_status"]).toBe("suggested");

    expect(upd?.["action"]).toBe("UPDATE");
    expect(upd?.["actor"]).toBe(T.underwriter);
    expect(upd?.["before_status"]).toBe("suggested"); // before
    expect(upd?.["after_status"]).toBe("overridden"); // after
    expect(upd?.["before_cents"]).toBe("12500000");
    expect(upd?.["after_cents"]).toBe("13000000");
  });

  it("captures deletes with the pre-image (actor null on admin connections)", async () => {
    const res = await runSql(
      [
        "begin;",
        SEED_SPINE,
        INSERT_FACT, // as postgres this time
        `delete from public.facts where id = '${T.fact}';`,
        `select action, actor_id as actor, before->>'value_cents' as before_cents, after
           from public.audit_log where row_id = '${T.fact}' order by id desc limit 1;`,
        "rollback;",
      ].join("\n"),
    );
    expect(res.ok, JSON.stringify(res.body)).toBe(true);
    const row = (res.body as Array<Record<string, unknown>>)[0];
    expect(row?.["action"]).toBe("DELETE");
    expect(row?.["actor"]).toBeNull();
    expect(row?.["before_cents"]).toBe("12500000");
    expect(row?.["after"]).toBeNull();
  });

  it("audits addbacks and loan_scenarios too", async () => {
    const res = await runSql(
      [
        "begin;",
        SEED_SPINE,
        AS_UNDERWRITER,
        `insert into public.addbacks (tenant_id, deal_id, category, amount_cents, note)
           values ('${T.tenant}', '${T.deal}', 'officer_comp', 5000000, 'audit test');`,
        `insert into public.loan_scenarios (tenant_id, deal_id, name, amount_cents,
             rate_spec, term_months)
           values ('${T.tenant}', '${T.deal}', 'Scenario 1', 100000000,
             '{"type":"prime_plus","spread_bps":275}', 120);`,
        "reset role;",
        `select table_name, action, actor_id as actor from public.audit_log
           where tenant_id = '${T.tenant}' and table_name in ('addbacks','loan_scenarios')
           order by table_name;`,
        "rollback;",
      ].join("\n"),
    );
    expect(res.ok, JSON.stringify(res.body)).toBe(true);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r["table_name"], r["action"], r["actor"]])).toEqual([
      ["addbacks", "INSERT", T.underwriter],
      ["loan_scenarios", "INSERT", T.underwriter],
    ]);
  });

  it("audit_log is append-only: direct INSERT/UPDATE/DELETE all denied for users", async () => {
    for (const stmt of [
      `insert into public.audit_log (tenant_id, action, table_name, row_id)
         values ('${T.tenant}', 'INSERT', 'facts', '${T.fact}');`,
      `update public.audit_log set action = 'UPDATE' where true;`,
      `delete from public.audit_log where true;`,
    ]) {
      const res = await runSql(
        ["begin;", SEED_SPINE, AS_UNDERWRITER, stmt, "rollback;"].join("\n"),
      );
      expect(res.ok).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/permission denied/i);
    }
  });

  it("worker mutations are audited as well (no way around the trail)", async () => {
    const res = await runSql(
      [
        "begin;",
        SEED_SPINE,
        "set local role credexis_worker;",
        INSERT_FACT.replace(`'${T.underwriter}');`, `null);`).replace(
          ", created_by)",
          ", created_by)",
        ),
        "reset role;",
        `select action, actor_id as actor from public.audit_log where row_id = '${T.fact}';`,
        "rollback;",
      ].join("\n"),
    );
    expect(res.ok, JSON.stringify(res.body)).toBe(true);
    const rows = res.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["action"]).toBe("INSERT");
    expect(rows[0]?.["actor"]).toBeNull(); // workers have no JWT
  });
});
