/**
 * RLS behavioral scenarios (M12.0). Skipped unless RLS_HARNESS_DATABASE_URL
 * points at a THROWAWAY Postgres (CI provides a service container) — the
 * harness applies migrations and seeds fixture tenants, so never aim it at
 * a real environment.
 *
 * Every scenario is a claim the platform design makes about the database:
 * tenant isolation, the role-tier lattice (A1), no client notification
 * inserts (B1), storage path scoping, the deactivation kill-switch, and
 * the anon EXECUTE revokes. New policies MUST add scenarios here
 * (synthesis §4 standing rule).
 */

import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, expectDenied, prepareDatabase } from "./harness.js";

const URL = process.env["RLS_HARNESS_DATABASE_URL"];

// Fixture uuids (stable so failures read well).
const U = {
  ownerA: "00000000-0000-4000-8000-0000000000a1",
  adminA: "00000000-0000-4000-8000-0000000000a2",
  underwriterA: "00000000-0000-4000-8000-0000000000a3",
  viewerA: "00000000-0000-4000-8000-0000000000a4",
  ownerB: "00000000-0000-4000-8000-0000000000b1",
} as const;
const TENANT_A = "00000000-0000-4000-8000-00000000aaaa";
const TENANT_B = "00000000-0000-4000-8000-00000000bbbb";
const DEAL_A = "00000000-0000-4000-8000-0000000000da";
const DEAL_B = "00000000-0000-4000-8000-0000000000db";
const NOTIF_A = "00000000-0000-4000-8000-0000000000f1";
const NOTIF_B = "00000000-0000-4000-8000-0000000000f2";

describe.skipIf(!URL)("RLS harness (live policies)", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = postgres(URL as string, { max: 4, onnotice: () => {} });
    await prepareDatabase(sql);

    // Seed as superuser (bypasses RLS; mirrors definer-owned bootstrap).
    await sql`insert into auth.users (id, email) values
      (${U.ownerA}, 'owner-a@test.dev'), (${U.adminA}, 'admin-a@test.dev'),
      (${U.underwriterA}, 'uw-a@test.dev'), (${U.viewerA}, 'viewer-a@test.dev'),
      (${U.ownerB}, 'owner-b@test.dev')`;
    await sql`insert into tenants (id, name, kind) values
      (${TENANT_A}, 'Tenant Alpha', 'broker_firm'),
      (${TENANT_B}, 'Tenant Bravo', 'lender')`;
    await sql`insert into profiles (id, tenant_id, email, role) values
      (${U.ownerA}, ${TENANT_A}, 'owner-a@test.dev', 'org_owner'),
      (${U.adminA}, ${TENANT_A}, 'admin-a@test.dev', 'admin'),
      (${U.underwriterA}, ${TENANT_A}, 'uw-a@test.dev', 'underwriter'),
      (${U.viewerA}, ${TENANT_A}, 'viewer-a@test.dev', 'viewer'),
      (${U.ownerB}, ${TENANT_B}, 'owner-b@test.dev', 'org_owner')`;
    const [pack] = await sql`insert into policy_packs (version, effective_date, rules)
      values ('rls-harness@test', '2026-01-01', '{}') returning id`;
    const packId = (pack as { id: string }).id;
    await sql`insert into deals (id, tenant_id, name, type, policy_pack_id) values
      (${DEAL_A}, ${TENANT_A}, 'Alpha Deal', 'business_acquisition', ${packId}),
      (${DEAL_B}, ${TENANT_B}, 'Bravo Deal', 'business_acquisition', ${packId})`;
    await sql`insert into notifications (id, tenant_id, recipient_id, kind, title) values
      (${NOTIF_A}, ${TENANT_A}, ${U.underwriterA}, 'document_processed', 'A card'),
      (${NOTIF_B}, ${TENANT_B}, ${U.ownerB}, 'document_processed', 'B card')`;
    await sql`insert into storage.objects (bucket_id, name) values
      ('deal-documents', ${TENANT_A + "/deals/" + DEAL_A + "/uploads/a.pdf"}),
      ('deal-documents', ${TENANT_B + "/deals/" + DEAL_B + "/uploads/b.pdf"})`;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
  });

  describe("tenant isolation", () => {
    it("a member sees only their tenant's deals", async () => {
      const rows = await asUser(sql, U.underwriterA, (tx) => tx`select id from deals`);
      expect(rows.map((r) => (r as { id: string }).id)).toEqual([DEAL_A]);
    });

    it("selecting another tenant's deal by id returns nothing (not an error — no oracle)", async () => {
      const rows = await asUser(
        sql,
        U.underwriterA,
        (tx) => tx`select id from deals where id = ${DEAL_B}`,
      );
      expect(rows.length).toBe(0);
    });

    it("anon cannot even SELECT deals — no grant, not just no rows", async () => {
      await expectDenied(() => asUser(sql, null, (tx) => tx`select id from deals`));
    });
  });

  describe("notifications (B1: no client inserts, own rows only)", () => {
    it("a user reads only their own notifications", async () => {
      const rows = await asUser(sql, U.underwriterA, (tx) => tx`select id from notifications`);
      expect(rows.map((r) => (r as { id: string }).id)).toEqual([NOTIF_A]);
    });

    it("authenticated INSERT is denied — cards are born server-side only", async () => {
      await expectDenied(() =>
        asUser(
          sql,
          U.ownerA,
          (tx) => tx`insert into notifications (tenant_id, recipient_id, kind, title)
            values (${TENANT_A}, ${U.ownerA}, 'document_processed', 'forged card')`,
        ),
      );
    });

    it("updating someone else's notification touches zero rows", async () => {
      const rows = await asUser(
        sql,
        U.viewerA,
        (tx) => tx`update notifications set state = 'read' where id = ${NOTIF_A} returning id`,
      );
      expect(rows.length).toBe(0);
    });
  });

  describe("invite lattice (A1: nobody grants at/above their own tier)", () => {
    const invite = (tx: Sql, invitedBy: string, role: string) =>
      tx`insert into invites (tenant_id, email, role, token_hash, invited_by, expires_at)
         values (${TENANT_A}, 'newcomer@test.dev', ${role}::user_role, ${"hash-" + role + invitedBy},
                 ${invitedBy}, now() + interval '7 days') returning id`;

    it("admin invites an underwriter — allowed", async () => {
      const rows = await asUser(sql, U.adminA, (tx) => invite(tx, U.adminA, "underwriter"));
      expect(rows.length).toBe(1);
    });

    it("admin minting an admin — denied by the DB, not just tRPC", async () => {
      await expectDenied(() => asUser(sql, U.adminA, (tx) => invite(tx, U.adminA, "admin")));
    });

    it("org_owner is unmintable even by the org_owner", async () => {
      await expectDenied(() => asUser(sql, U.ownerA, (tx) => invite(tx, U.ownerA, "org_owner")));
    });

    it("underwriters cannot invite anyone", async () => {
      await expectDenied(() =>
        asUser(sql, U.underwriterA, (tx) => invite(tx, U.underwriterA, "viewer")),
      );
    });

    it("viewers cannot even list invites", async () => {
      const rows = await asUser(sql, U.viewerA, (tx) => tx`select id from invites`);
      expect(rows.length).toBe(0);
    });
  });

  describe("profiles (self-service is definer-only; org_owner untouchable)", () => {
    it("nobody edits their own row directly — not even their display name", async () => {
      const rows = await asUser(
        sql,
        U.viewerA,
        (tx) => tx`update profiles set full_name = 'Sneaky' where id = ${U.viewerA} returning id`,
      );
      expect(rows.length).toBe(0);
    });

    it("update_own_profile() changes name + email pref for the caller only", async () => {
      await asUser(sql, U.viewerA, (tx) => tx`select update_own_profile('Vera Viewer', false)`);
      const [row] = await sql`select full_name, email_notifications, role
        from profiles where id = ${U.viewerA}`;
      expect(row).toMatchObject({
        full_name: "Vera Viewer",
        email_notifications: false,
        role: "viewer",
      });
    });

    it("admin manages members below their tier", async () => {
      const rows = await asUser(
        sql,
        U.adminA,
        (tx) => tx`update profiles set role = 'viewer' where id = ${U.underwriterA} returning id`,
      );
      expect(rows.length).toBe(1);
      await sql`update profiles set role = 'underwriter' where id = ${U.underwriterA}`;
    });

    it("the org_owner row is untouchable by admins", async () => {
      const rows = await asUser(
        sql,
        U.adminA,
        (tx) => tx`update profiles set role = 'viewer' where id = ${U.ownerA} returning id`,
      );
      expect(rows.length).toBe(0);
    });
  });

  describe("deactivation kill-switch", () => {
    it("a deactivated profile goes dark instantly", async () => {
      await sql`update profiles set status = 'deactivated' where id = ${U.underwriterA}`;
      try {
        const rows = await asUser(sql, U.underwriterA, (tx) => tx`select id from deals`);
        expect(rows.length).toBe(0);
      } finally {
        await sql`update profiles set status = 'active' where id = ${U.underwriterA}`;
      }
    });
  });

  describe("storage path scoping", () => {
    it("members read only objects under their tenant prefix", async () => {
      const rows = await asUser(sql, U.underwriterA, (tx) => tx`select name from storage.objects`);
      expect(rows.length).toBe(1);
      expect((rows[0] as { name: string }).name.startsWith(TENANT_A)).toBe(true);
    });

    it("uploading under another tenant's prefix is denied", async () => {
      await expectDenied(() =>
        asUser(
          sql,
          U.underwriterA,
          (tx) => tx`insert into storage.objects (bucket_id, name)
            values ('deal-documents', ${TENANT_B + "/deals/" + DEAL_B + "/uploads/evil.pdf"})`,
        ),
      );
    });
  });

  describe("deal upload limits (M12.1 backstop trigger)", () => {
    const insertDoc = (tx: Sql, n: number, bytes: number) =>
      tx`insert into documents (tenant_id, deal_id, file_name, storage_path, sha256, bytes, mime_type)
         values (${TENANT_A}, ${DEAL_A}, ${"q" + n + ".pdf"},
                 ${TENANT_A + "/deals/" + DEAL_A + "/uploads/q" + n + ".pdf"},
                 ${String(n).padStart(64, "0")}, ${bytes}, 'application/pdf')
         returning id`;

    it("doc-count limit binds even for legitimate uploaders", async () => {
      await sql`update tenants set settings = '{"limits":{"maxDocsPerDeal":2}}' where id = ${TENANT_A}`;
      try {
        await asUser(sql, U.underwriterA, (tx) => insertDoc(tx, 1, 100));
        await asUser(sql, U.underwriterA, (tx) => insertDoc(tx, 2, 100));
        const err = await expectDenied(() =>
          asUser(sql, U.underwriterA, (tx) => insertDoc(tx, 3, 100)),
        );
        expect(err.message).toContain("document limit");
      } finally {
        await sql`delete from documents where deal_id = ${DEAL_A}`;
        await sql`update tenants set settings = '{}' where id = ${TENANT_A}`;
      }
    });

    it("byte limit binds; superuser/service-role inserts are NOT exempt", async () => {
      await sql`update tenants set settings = '{"limits":{"maxBytesPerDeal":1000}}' where id = ${TENANT_A}`;
      try {
        await asUser(sql, U.underwriterA, (tx) => insertDoc(tx, 4, 600));
        // The backstop is a BEFORE INSERT trigger, not RLS — even the
        // superuser connection (the worker's posture) hits the wall.
        const err = await expectDenied(() => insertDoc(sql, 5, 600));
        expect(err.message).toContain("storage limit");
      } finally {
        await sql`delete from documents where deal_id = ${DEAL_A}`;
        await sql`update tenants set settings = '{}' where id = ${TENANT_A}`;
      }
    });

    it("CONCURRENT inserts cannot exceed the quota (advisory lock, 0022)", async () => {
      // The first cut read-then-checked with no lock: N parallel uploads
      // each saw the pre-burst count and all committed. This fires 10 at
      // once against a limit of 3 — exactly the borrower threat model.
      await sql`update tenants set settings = '{"limits":{"maxDocsPerDeal":3}}' where id = ${TENANT_A}`;
      try {
        const attempts = await Promise.allSettled(
          Array.from({ length: 10 }, (_, i) =>
            asUser(sql, U.underwriterA, (tx) => insertDoc(tx, 100 + i, 10)),
          ),
        );
        const accepted = attempts.filter((a) => a.status === "fulfilled").length;
        const [row] = await sql`select count(*)::int as n from documents where deal_id = ${DEAL_A}`;
        expect(accepted).toBe(3);
        expect((row as { n: number }).n).toBe(3);
      } finally {
        await sql`delete from documents where deal_id = ${DEAL_A}`;
        await sql`update tenants set settings = '{}' where id = ${TENANT_A}`;
      }
    });

    it("JSON-string overrides are ignored by BOTH parsers (no route/DB disagreement)", async () => {
      // {"maxDocsPerDeal":"2"} is a string, not a number: resolveDealLimits
      // rejects it, so the DB must too — otherwise the route's friendly
      // wall sits at 60 while the trigger rejects at 2, surfacing as a
      // confusing hard error instead of the quota message.
      await sql`update tenants set settings = '{"limits":{"maxDocsPerDeal":"2"}}' where id = ${TENANT_A}`;
      try {
        for (let i = 0; i < 3; i++) {
          const rows = await asUser(sql, U.underwriterA, (tx) => insertDoc(tx, 200 + i, 10));
          expect(rows.length).toBe(1);
        }
      } finally {
        await sql`delete from documents where deal_id = ${DEAL_A}`;
        await sql`update tenants set settings = '{}' where id = ${TENANT_A}`;
      }
    });

    it("malformed limit overrides fall back to defaults, never off", async () => {
      await sql`update tenants set settings = '{"limits":{"maxDocsPerDeal":"lots","maxBytesPerDeal":-5}}' where id = ${TENANT_A}`;
      try {
        const rows = await asUser(sql, U.underwriterA, (tx) => insertDoc(tx, 6, 100));
        expect(rows.length).toBe(1); // defaults (60 / 1 GiB) allow it
      } finally {
        await sql`delete from documents where deal_id = ${DEAL_A}`;
        await sql`update tenants set settings = '{}' where id = ${TENANT_A}`;
      }
    });
  });

  describe("audit tamper evidence (M12.3 hash chain)", () => {
    // These mutate audit_log directly — only possible as superuser on this
    // throwaway database, which is exactly the adversary the chain models:
    // someone with DB credentials rewriting history. Never run against a
    // real environment.
    const auditRows = () =>
      sql`select id, action from audit_log where tenant_id = ${TENANT_A} order by id`;
    const breaks = () => sql`select broken_at, reason from verify_audit_chain(${TENANT_A})`;

    it("normal writes build an intact chain", async () => {
      // Any audited write seeds rows; profiles/tenants/invites are audited.
      await sql`update profiles set full_name = 'Chain Seed 1' where id = ${U.viewerA}`;
      await sql`update profiles set full_name = 'Chain Seed 2' where id = ${U.viewerA}`;
      const rows = await auditRows();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect((await breaks()).length).toBe(0);
    });

    it("every row commits to its predecessor", async () => {
      const rows =
        await sql`select prev_hash, row_hash from audit_log where tenant_id = ${TENANT_A} order by id`;
      expect((rows[0] as { prev_hash: string | null }).prev_hash).toBeNull();
      for (let i = 1; i < rows.length; i++) {
        expect((rows[i] as { prev_hash: string }).prev_hash).toBe(
          (rows[i - 1] as { row_hash: string }).row_hash,
        );
      }
    });

    it("ALTERING a historical row is detected", async () => {
      const rows = await auditRows();
      const victim = rows[0] as { id: string; action: string };
      await sql`update audit_log set action = 'tampered' where id = ${victim.id}`;
      try {
        const found = await breaks();
        expect(found.length).toBe(1);
        expect((found[0] as { broken_at: string }).broken_at).toBe(victim.id);
        expect((found[0] as { reason: string }).reason).toContain("altered");
      } finally {
        await sql`update audit_log set action = ${victim.action} where id = ${victim.id}`;
      }
      expect((await breaks()).length).toBe(0); // restoring the row restores the chain
    });

    it("DELETING a historical row is detected", async () => {
      const rows = await auditRows();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const victim = rows[0] as { id: string };
      // Delete inside a transaction we abort: the break is observed WHILE the
      // row is missing, then the rollback restores history byte-exactly. A
      // hand-rebuilt row could be restored subtly wrong and would prove
      // nothing, so we never rebuild one.
      let found: readonly unknown[] = [];
      const ROLLBACK = "intentional-rollback";
      await sql
        .begin(async (tx) => {
          await tx`delete from audit_log where id = ${victim.id}`;
          // The row after the hole no longer matches its recorded predecessor.
          found = await tx`select broken_at, reason from verify_audit_chain(${TENANT_A})`;
          throw new Error(ROLLBACK);
        })
        .catch((e: Error) => {
          if (e.message !== ROLLBACK) throw e;
        });

      expect(found.length).toBe(1);
      expect((found[0] as { reason: string }).reason).toContain("altered or removed");
      // Chain intact and row count unchanged — the test left no damage.
      expect((await breaks()).length).toBe(0);
      expect((await auditRows()).length).toBe(rows.length);
    });

    it("chains are independent per tenant — one tenant's history cannot break another's", async () => {
      await sql`update profiles set full_name = 'B seed' where id = ${U.ownerB}`;
      const [row] = await sql`select count(*)::int as n from verify_audit_chain(${TENANT_B})`;
      expect((row as { n: number }).n).toBe(0);
      expect((await breaks()).length).toBe(0);
    });
  });

  describe("borrower invites — org side (M12.1 PR1)", () => {
    const mint = (tx: Sql, by: string, extra = "") =>
      tx.unsafe(
        `insert into borrower_invites
           (tenant_id, deal_id, email, token_hash, display_label, invited_by, expires_at ${extra ? ", " + extra.split("=")[0] : ""})
         values ('${TENANT_A}', '${DEAL_A}', 'borrower@test.dev',
                 'hash-${by}-${extra}', 'Alpha Deal', '${by}', now() + interval '30 days'
                 ${extra ? ", " + extra.split("=")[1] : ""})
         returning id`,
      );

    it("underwriter+ can mint an invite on their own deal", async () => {
      const rows = await asUser(sql, U.underwriterA, (tx) => mint(tx, U.underwriterA));
      expect(rows.length).toBe(1);
      await sql`delete from borrower_invites where deal_id = ${DEAL_A}`;
    });

    it("viewers cannot mint (tier floor)", async () => {
      await expectDenied(() => asUser(sql, U.viewerA, (tx) => mint(tx, U.viewerA)));
    });

    it("an invite cannot be minted onto another tenant's deal", async () => {
      await expectDenied(() =>
        asUser(
          sql,
          U.underwriterA,
          (tx) =>
            tx`insert into borrower_invites
               (tenant_id, deal_id, email, token_hash, display_label, invited_by, expires_at)
             values (${TENANT_A}, ${DEAL_B}, 'x@test.dev', 'hash-cross', 'X',
                     ${U.underwriterA}, now() + interval '30 days')`,
        ),
      );
    });

    it("a broker cannot re-point a live invite at another deal (column grant, not RLS)", async () => {
      const [inv] = await asUser(sql, U.underwriterA, (tx) => mint(tx, U.underwriterA));
      const id = (inv as { id: string }).id;
      try {
        // deal_id is NOT in the UPDATE column grant — the write is refused
        // even though the row is visible and updatable in other columns.
        await expectDenied(() =>
          asUser(
            sql,
            U.underwriterA,
            (tx) => tx`update borrower_invites set deal_id = ${DEAL_B} where id = ${id}`,
          ),
        );
        // …while a granted column succeeds, proving the row IS reachable.
        const ok = await asUser(
          sql,
          U.underwriterA,
          (tx) =>
            tx`update borrower_invites set portal_status = 'in_review' where id = ${id} returning id`,
        );
        expect(ok.length).toBe(1);
      } finally {
        await sql`delete from borrower_invites where id = ${id}`;
      }
    });

    it("nobody can hand themselves an invite: auth_user_id is definer-only", async () => {
      const [inv] = await asUser(sql, U.underwriterA, (tx) => mint(tx, U.underwriterA));
      const id = (inv as { id: string }).id;
      try {
        await expectDenied(() =>
          asUser(
            sql,
            U.underwriterA,
            (tx) =>
              tx`update borrower_invites set auth_user_id = ${U.underwriterA} where id = ${id}`,
          ),
        );
      } finally {
        await sql`delete from borrower_invites where id = ${id}`;
      }
    });

    it("another tenant sees no invites at all", async () => {
      const [inv] = await asUser(sql, U.underwriterA, (tx) => mint(tx, U.underwriterA));
      const id = (inv as { id: string }).id;
      try {
        const rows = await asUser(sql, U.ownerB, (tx) => tx`select id from borrower_invites`);
        expect(rows.length).toBe(0);
      } finally {
        await sql`delete from borrower_invites where id = ${id}`;
      }
    });

    it("a signed-in user with NO profile (the borrower shape) reaches nothing", async () => {
      // This is the spine: no profiles row ⇒ current_tenant_id() is NULL ⇒
      // every policy in the database is vacuously false. Proven, not assumed.
      const STRANGER = "00000000-0000-4000-8000-0000000000c9";
      await sql`insert into auth.users (id, email) values (${STRANGER}, 'nobody@test.dev')
                on conflict (id) do nothing`;
      const [inv] = await asUser(sql, U.underwriterA, (tx) => mint(tx, U.underwriterA));
      const id = (inv as { id: string }).id;
      try {
        for (const table of ["borrower_invites", "document_requests", "deals", "documents"]) {
          const rows = await asUser(sql, STRANGER, (tx) =>
            tx.unsafe(`select 1 from ${table} limit 1`),
          );
          expect(rows.length, `${table} leaked to a profile-less user`).toBe(0);
        }
      } finally {
        await sql`delete from borrower_invites where id = ${id}`;
      }
    });
  });

  describe("definer EXECUTE surface", () => {
    it("anon cannot execute create_organization", async () => {
      const [row] = await sql`select has_function_privilege('anon',
        'public.create_organization(text, org_kind)', 'EXECUTE') as ok`;
      expect((row as { ok: boolean }).ok).toBe(false);
    });

    it("anon cannot execute update_own_profile", async () => {
      const [row] = await sql`select has_function_privilege('anon',
        'public.update_own_profile(text, boolean)', 'EXECUTE') as ok`;
      expect((row as { ok: boolean }).ok).toBe(false);
    });
  });
});
