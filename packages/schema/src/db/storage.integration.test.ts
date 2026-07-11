/**
 * Storage RLS integration test (M2.4): the `deal-documents` bucket enforces
 * per-tenant prefixes against the LIVE database, same harness as
 * rls.integration.test.ts (Management API + role/JWT impersonation).
 *
 * Supabase blocks direct SQL DELETEs on storage tables with a
 * STATEMENT-level trigger (`storage.protect_delete()`) that fires before RLS
 * evaluates any row — production deletes go through the Storage API, which
 * enforces these same policies. So: object rows are only ever seeded INSIDE
 * rolled-back transactions, and delete-policy correctness is asserted from
 * pg_policies (the Storage-API delete path gets e2e coverage in M3.1).
 *
 * Runs only when SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF are present.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const token = process.env["SUPABASE_ACCESS_TOKEN"];
const ref = process.env["SUPABASE_PROJECT_REF"];
const live = Boolean(token && ref);

const T = {
  tenantA: "00000000-0000-4000-b000-00000000000a",
  tenantB: "00000000-0000-4000-b000-00000000000b",
  underwriterA: "00000000-0000-4000-b000-0000000000aa",
  viewerA: "00000000-0000-4000-b000-0000000000ac",
  adminA: "00000000-0000-4000-b000-0000000000ad",
};

const objA = `${T.tenantA}/deals/00000000-0000-4000-b000-0000000000da/uploads/${"a".repeat(64)}.pdf`;
const objB = `${T.tenantB}/deals/00000000-0000-4000-b000-0000000000db/uploads/${"b".repeat(64)}.pdf`;

/** Object rows seeded per-test inside a transaction, always rolled back. */
const SEED_OBJECTS = `insert into storage.objects (bucket_id, name) values
  ('deal-documents', '${objA}'), ('deal-documents', '${objB}');`;

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

/** Seed objects as postgres, then run `statements` as the user — rolled back. */
function withObjectsAsUser(userId: string, statements: string): string {
  return [
    "begin;",
    SEED_OBJECTS,
    "set local role authenticated;",
    `set local request.jwt.claims to '{"sub":"${userId}","role":"authenticated"}';`,
    statements,
    "rollback;",
  ].join("\n");
}

function asUser(userId: string, statements: string): string {
  return [
    "begin;",
    "set local role authenticated;",
    `set local request.jwt.claims to '{"sub":"${userId}","role":"authenticated"}';`,
    statements,
    "rollback;",
  ].join("\n");
}

const seedAuthUser = (id: string, email: string) =>
  `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at)
   values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', '${email}', '', now(), now(), now());`;

const CLEANUP = `
  delete from public.profiles where id in ('${T.underwriterA}','${T.viewerA}','${T.adminA}');
  delete from auth.users where id in ('${T.underwriterA}','${T.viewerA}','${T.adminA}');
  delete from public.tenants where id in ('${T.tenantA}','${T.tenantB}');
`;

const SEED = `
  insert into public.tenants (id, name) values
    ('${T.tenantA}', 'Storage Tenant A'), ('${T.tenantB}', 'Storage Tenant B');
  ${seedAuthUser(T.underwriterA, "stor-uw@test.local")}
  ${seedAuthUser(T.viewerA, "stor-view@test.local")}
  ${seedAuthUser(T.adminA, "stor-admin@test.local")}
  insert into public.profiles (id, tenant_id, role, email) values
    ('${T.underwriterA}', '${T.tenantA}', 'underwriter', 'stor-uw@test.local'),
    ('${T.viewerA}', '${T.tenantA}', 'viewer', 'stor-view@test.local'),
    ('${T.adminA}', '${T.tenantA}', 'admin', 'stor-admin@test.local');
`;

describe.skipIf(!live)("Storage RLS (live database)", () => {
  beforeAll(async () => {
    await runSql(CLEANUP);
    const seeded = await runSql(SEED);
    expect(seeded.ok, JSON.stringify(seeded.body)).toBe(true);
  }, 60_000);

  afterAll(async () => {
    const cleaned = await runSql(CLEANUP);
    expect(cleaned.ok, JSON.stringify(cleaned.body)).toBe(true);
  }, 60_000);

  it("bucket exists, is private, and enforces size/type limits", async () => {
    const res = await runSql(
      `select public, file_size_limit, array_length(allowed_mime_types, 1) as mimes
       from storage.buckets where id = 'deal-documents';`,
    );
    expect(res.ok).toBe(true);
    const row = (res.body as Array<Record<string, unknown>>)[0];
    expect(row?.["public"]).toBe(false);
    expect(row?.["file_size_limit"]).toBe(52428800);
    expect(row?.["mimes"]).toBe(6);
  });

  it("tenant A sees only its own objects", async () => {
    const res = await runSql(
      withObjectsAsUser(
        T.underwriterA,
        `select name from storage.objects where bucket_id = 'deal-documents' order by name;`,
      ),
    );
    expect(res.ok, JSON.stringify(res.body)).toBe(true);
    const rows = (res.body as Array<{ name: string }>).map((r) => r.name);
    expect(rows).toEqual([objA]);
  });

  it("underwriter can insert under OWN tenant prefix (rolled back)", async () => {
    const key = `${T.tenantA}/deals/00000000-0000-4000-b000-0000000000da/uploads/${"c".repeat(64)}.pdf`;
    const res = await runSql(
      asUser(
        T.underwriterA,
        `insert into storage.objects (bucket_id, name) values ('deal-documents', '${key}') returning name;`,
      ),
    );
    expect(res.ok, JSON.stringify(res.body)).toBe(true);
  });

  it("underwriter CANNOT insert under the OTHER tenant's prefix", async () => {
    const key = `${T.tenantB}/deals/00000000-0000-4000-b000-0000000000db/uploads/${"d".repeat(64)}.pdf`;
    const res = await runSql(
      asUser(
        T.underwriterA,
        `insert into storage.objects (bucket_id, name) values ('deal-documents', '${key}');`,
      ),
    );
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res.body)).toMatch(/row-level security/i);
  });

  it("viewer cannot insert at all (read-only role)", async () => {
    const key = `${T.tenantA}/deals/00000000-0000-4000-b000-0000000000da/uploads/${"e".repeat(64)}.pdf`;
    const res = await runSql(
      asUser(
        T.viewerA,
        `insert into storage.objects (bucket_id, name) values ('deal-documents', '${key}');`,
      ),
    );
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res.body)).toMatch(/row-level security/i);
  });

  it("objects are immutable: UPDATE matches zero rows even for admin", async () => {
    const res = await runSql(
      withObjectsAsUser(
        T.adminA,
        `update storage.objects set name = name where bucket_id = 'deal-documents' returning name;`,
      ),
    );
    // No UPDATE policy exists → RLS filters every row out (0 rows, no error).
    expect(res.ok, JSON.stringify(res.body)).toBe(true);
    expect(res.body as unknown[]).toHaveLength(0);
  });

  it("delete policy is admin-only + tenant-scoped; no UPDATE policy exists", async () => {
    // Supabase's protect_delete() trigger is STATEMENT-level: it blocks every
    // direct SQL DELETE before RLS sees a single row, so delete policies are
    // only exercisable through the Storage API (covered by the M3.1 upload
    // flow e2e). Here we assert the policy definitions themselves — live
    // schema truth from pg_policies.
    const res = await runSql(
      `select cmd, qual from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'deal_documents_tenant_%'
       order by cmd;`,
    );
    expect(res.ok).toBe(true);
    const rows = res.body as Array<{ cmd: string; qual: string | null }>;
    expect(rows.map((r) => r.cmd)).toEqual(["DELETE", "INSERT", "SELECT"]); // no UPDATE
    const del = rows.find((r) => r.cmd === "DELETE");
    expect(del?.qual).toContain("'admin'");
    expect(del?.qual).toContain("current_tenant_id()");
    expect(del?.qual).toContain("'deal-documents'");
  });

  it("pipeline worker reads the bucket cross-tenant (scoped in code, not RLS)", async () => {
    const res = await runSql(
      [
        "begin;",
        SEED_OBJECTS,
        "set local role credexis_worker;",
        `select count(*)::int as n from storage.objects where bucket_id = 'deal-documents';`,
        "rollback;",
      ].join("\n"),
    );
    expect(res.ok, JSON.stringify(res.body)).toBe(true);
    expect((res.body as Array<{ n: number }>)[0]?.n).toBe(2);
  });
});
