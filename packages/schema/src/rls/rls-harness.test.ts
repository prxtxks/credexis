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

  describe("borrowers — durable identity (M12.1)", () => {
    const addBorrower = (
      tx: Sql,
      by: string,
      tenant: string,
      email: string,
      name = "Jane Q Borrower",
    ) =>
      tx`insert into borrowers (tenant_id, full_name, email, created_by)
         values (${tenant}, ${name}, ${email}, ${by}) returning id`;

    afterAll(async () => {
      await sql`delete from borrowers where email like '%@borrower-test.dev'`;
    });

    it("underwriter+ can add a borrower; viewers cannot", async () => {
      const rows = await asUser(sql, U.underwriterA, (tx) =>
        addBorrower(tx, U.underwriterA, TENANT_A, "one@borrower-test.dev"),
      );
      expect(rows.length).toBe(1);
      await expectDenied(() =>
        asUser(sql, U.viewerA, (tx) =>
          addBorrower(tx, U.viewerA, TENANT_A, "two@borrower-test.dev"),
        ),
      );
    });

    it("the same email twice in ONE tenant is rejected (identity is unique)", async () => {
      await asUser(sql, U.underwriterA, (tx) =>
        addBorrower(tx, U.underwriterA, TENANT_A, "dup@borrower-test.dev"),
      );
      // Case-insensitively — an address variant is the same person.
      await expectDenied(() =>
        asUser(sql, U.underwriterA, (tx) =>
          addBorrower(tx, U.underwriterA, TENANT_A, "DUP@Borrower-Test.dev"),
        ),
      );
    });

    it("the same email in a DIFFERENT tenant is allowed — and invisible either way", async () => {
      // Two lenders may legitimately both work with the same borrower. A
      // global unique index would not only reject this, it would leak that
      // another tenant holds them.
      const rows = await asUser(sql, U.ownerB, (tx) =>
        addBorrower(tx, U.ownerB, TENANT_B, "dup@borrower-test.dev"),
      );
      expect(rows.length).toBe(1);
      const seenByA = await asUser(
        sql,
        U.underwriterA,
        (tx) => tx`select id from borrowers where lower(email) = 'dup@borrower-test.dev'`,
      );
      expect(seenByA.length).toBe(1); // only their own
    });

    it("a borrower cannot be moved to another tenant (column grant)", async () => {
      const [b] = await asUser(sql, U.underwriterA, (tx) =>
        addBorrower(tx, U.underwriterA, TENANT_A, "move@borrower-test.dev"),
      );
      const id = (b as { id: string }).id;
      await expectDenied(() =>
        asUser(
          sql,
          U.underwriterA,
          (tx) => tx`update borrowers set tenant_id = ${TENANT_B} where id = ${id}`,
        ),
      );
      // …but correcting the name is allowed, proving the row is reachable.
      const ok = await asUser(
        sql,
        U.underwriterA,
        (tx) =>
          tx`update borrowers set full_name = 'Jane Q. Borrower' where id = ${id} returning id`,
      );
      expect(ok.length).toBe(1);
    });

    it("changing the email while a live invite is bound to it is refused", async () => {
      const [b] = await asUser(sql, U.underwriterA, (tx) =>
        addBorrower(tx, U.underwriterA, TENANT_A, "bound@borrower-test.dev"),
      );
      const bid = (b as { id: string }).id;
      const [inv] = await asUser(
        sql,
        U.underwriterA,
        (tx) => tx`insert into borrower_invites
             (tenant_id, deal_id, borrower_id, email, token_hash, display_label, invited_by, expires_at)
           values (${TENANT_A}, ${DEAL_A}, ${bid}, 'bound@borrower-test.dev', 'hash-bound',
                   'Alpha Deal', ${U.underwriterA}, now() + interval '30 days') returning id`,
      );
      const invId = (inv as { id: string }).id;
      try {
        // A silent re-target would break the claim binding without anyone
        // seeing it; revoke-and-re-mint is the visible path.
        const err = await expectDenied(() =>
          asUser(
            sql,
            U.underwriterA,
            (tx) =>
              tx`update borrowers set email = 'elsewhere@borrower-test.dev' where id = ${bid}`,
          ),
        );
        expect(err.message).toContain("live invite");
      } finally {
        await sql`delete from borrower_invites where id = ${invId}`;
      }
    });

    it("one live invite per borrower per deal", async () => {
      const [b] = await asUser(sql, U.underwriterA, (tx) =>
        addBorrower(tx, U.underwriterA, TENANT_A, "once@borrower-test.dev"),
      );
      const bid = (b as { id: string }).id;
      const mint = (tx: Sql, hash: string) =>
        tx`insert into borrower_invites
             (tenant_id, deal_id, borrower_id, email, token_hash, display_label, invited_by, expires_at)
           values (${TENANT_A}, ${DEAL_A}, ${bid}, 'once@borrower-test.dev', ${hash},
                   'Alpha Deal', ${U.underwriterA}, now() + interval '30 days') returning id`;
      const [first] = await asUser(sql, U.underwriterA, (tx) => mint(tx, "hash-once-1"));
      try {
        await expectDenied(() => asUser(sql, U.underwriterA, (tx) => mint(tx, "hash-once-2")));
      } finally {
        await sql`delete from borrower_invites where id = ${(first as { id: string }).id}`;
      }
    });
  });

  describe("borrower invites — org side (M12.1 PR1)", () => {
    let borrowerA = "";
    let hashSeq = 0;

    beforeAll(async () => {
      const [b] = await sql`insert into borrowers (tenant_id, full_name, email, created_by)
        values (${TENANT_A}, 'Invite Fixture', 'invite-fixture@borrower-test.dev',
                ${U.underwriterA}) returning id`;
      borrowerA = (b as { id: string }).id;
    });

    const mint = (tx: Sql, by: string) =>
      tx`insert into borrower_invites
           (tenant_id, deal_id, borrower_id, email, token_hash, display_label, invited_by, expires_at)
         values (${TENANT_A}, ${DEAL_A}, ${borrowerA}, 'borrower@test.dev',
                 ${`hash-${by}-${hashSeq++}`}, 'Alpha Deal', ${by}, now() + interval '30 days')
         returning id`;

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
               (tenant_id, deal_id, borrower_id, email, token_hash, display_label, invited_by, expires_at)
             values (${TENANT_A}, ${DEAL_B}, ${borrowerA}, 'x@test.dev', 'hash-cross', 'X',
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

  describe("borrower access path (M12.1 PR2) — the only two policies they match", () => {
    // A claimed borrower. claim_borrower_invite() lands in the next
    // migration, so the claim is simulated here by setting auth_user_id as
    // superuser — the access path under test is identical either way.
    const BORROWER = "00000000-0000-4000-8000-0000000000e1";
    const OTHER_BORROWER = "00000000-0000-4000-8000-0000000000e2";
    let inviteId = "";
    let otherInviteId = "";
    let prefix = "";
    const sha = (n: number) => String(n).padStart(64, "0");
    const key = (p: string, n: number) => `${p}${sha(n)}.pdf`;

    beforeAll(async () => {
      await sql`insert into auth.users (id, email) values
        (${BORROWER}, 'claimed@borrower-test.dev'),
        (${OTHER_BORROWER}, 'other@borrower-test.dev') on conflict (id) do nothing`;
      const [b1] = await sql`insert into borrowers (tenant_id, full_name, email, created_by)
        values (${TENANT_A}, 'Claimed Borrower', 'claimed@borrower-test.dev', ${U.underwriterA})
        returning id`;
      const [b2] = await sql`insert into borrowers (tenant_id, full_name, email, created_by)
        values (${TENANT_A}, 'Other Borrower', 'other@borrower-test.dev', ${U.underwriterA})
        returning id`;
      const mk = async (borrowerId: string, uid: string, hash: string) => {
        const [row] = await sql`insert into borrower_invites
          (tenant_id, deal_id, borrower_id, email, token_hash, display_label, invited_by,
           expires_at, status, auth_user_id, claimed_at)
          values (${TENANT_A}, ${DEAL_A}, ${borrowerId},
                  ${uid === BORROWER ? "claimed@borrower-test.dev" : "other@borrower-test.dev"},
                  ${hash}, 'Alpha Deal', ${U.underwriterA}, now() + interval '30 days',
                  'active', ${uid}, now()) returning id`;
        return (row as { id: string }).id;
      };
      inviteId = await mk((b1 as { id: string }).id, BORROWER, "hash-claimed");
      otherInviteId = await mk((b2 as { id: string }).id, OTHER_BORROWER, "hash-other");
      prefix = `${TENANT_A}/deals/${DEAL_A}/borrower-uploads/${inviteId}/`;
    });

    afterAll(async () => {
      await sql`delete from storage.objects where name like ${`${TENANT_A}/deals/${DEAL_A}/borrower-uploads/%`}`;
      await sql`delete from borrower_invites where token_hash in ('hash-claimed','hash-other')`;
    });

    const upload = (uid: string, name: string) =>
      asUser(
        sql,
        uid,
        (tx) =>
          tx`insert into storage.objects (bucket_id, name) values ('deal-documents', ${name}) returning id`,
      );

    it("a claimed borrower CAN upload under their own invite prefix", async () => {
      const rows = await upload(BORROWER, key(prefix, 1));
      expect(rows.length).toBe(1);
    });

    it("cannot forge the INVITE segment (another borrower's folder, same deal)", async () => {
      const forged = `${TENANT_A}/deals/${DEAL_A}/borrower-uploads/${otherInviteId}/${sha(2)}.pdf`;
      await expectDenied(() => upload(BORROWER, forged));
    });

    it("cannot forge the DEAL segment", async () => {
      await expectDenied(() =>
        upload(BORROWER, `${TENANT_A}/deals/${DEAL_B}/borrower-uploads/${inviteId}/${sha(3)}.pdf`),
      );
    });

    it("cannot forge the TENANT segment", async () => {
      await expectDenied(() =>
        upload(BORROWER, `${TENANT_B}/deals/${DEAL_A}/borrower-uploads/${inviteId}/${sha(4)}.pdf`),
      );
    });

    it("cannot escape into the staff upload prefix", async () => {
      await expectDenied(() =>
        upload(BORROWER, `${TENANT_A}/deals/${DEAL_A}/uploads/${sha(5)}.pdf`),
      );
    });

    it("rejects wrong path shapes and filenames (never raises — a cast error would be an oracle)", async () => {
      for (const bad of [
        `${TENANT_A}/deals/${DEAL_A}/borrower-uploads/${inviteId}/extra/${sha(6)}.pdf`, // 7 elements
        `${TENANT_A}/deals/${DEAL_A}/borrower-uploads/${inviteId}`, // 5 elements
        `${TENANT_A}/deals/${DEAL_A}/borrower-uploads/${inviteId}/notahash.pdf`,
        `${TENANT_A}/deals/${DEAL_A}/borrower-uploads/${inviteId}/${sha(7)}.exe`,
        `not-a-uuid/deals/${DEAL_A}/borrower-uploads/${inviteId}/${sha(8)}.pdf`,
      ]) {
        await expectDenied(() => upload(BORROWER, bad));
      }
    });

    it("reads ONLY their own objects — not staff uploads on the same deal", async () => {
      const seen = await asUser(
        sql,
        BORROWER,
        (tx) => tx`select name from storage.objects where bucket_id = 'deal-documents'`,
      );
      expect(seen.length).toBeGreaterThan(0);
      for (const r of seen) {
        expect((r as { name: string }).name.startsWith(prefix)).toBe(true);
      }
    });

    it("reaches NOTHING in public — including the reference tables (A-3)", async () => {
      for (const t of [
        "deals",
        "documents",
        "borrower_invites",
        "borrowers",
        "taxonomy_nodes",
        "form_registry",
        "policy_packs",
        "learned_mappings",
      ]) {
        const rows = await asUser(sql, BORROWER, (tx) => tx.unsafe(`select 1 from ${t} limit 1`));
        expect(rows.length, `${t} leaked to a borrower`).toBe(0);
      }
    });

    it("REVOKING cuts access on the very next statement — and cannot be undone", async () => {
      // Uses the OTHER borrower's invite and leaves it revoked: revocation is
      // terminal by design (0026's guard), so a test that "restores" it would
      // be asserting something the database must refuse.
      const otherPrefix = `${TENANT_A}/deals/${DEAL_A}/borrower-uploads/${otherInviteId}/`;
      const before = await upload(OTHER_BORROWER, key(otherPrefix, 40));
      expect(before.length).toBe(1);

      await sql`update borrower_invites set status = 'revoked', revoked_at = now()
                where id = ${otherInviteId}`;

      await expectDenied(() => upload(OTHER_BORROWER, key(otherPrefix, 41)));
      const seen = await asUser(
        sql,
        OTHER_BORROWER,
        (tx) => tx`select name from storage.objects where bucket_id = 'deal-documents'`,
      );
      expect(seen.length).toBe(0); // their own uploads become unreadable too

      // Revocation is one-way: nobody un-revokes an invite, staff included.
      const err = await expectDenied(
        () =>
          sql`update borrower_invites set status = 'active', revoked_at = null
               where id = ${otherInviteId}`,
      );
      expect(err.message).toContain("terminal");
    });

    it("an EXPIRED invite is dead without anyone revoking it", async () => {
      await sql`update borrower_invites set expires_at = now() - interval '1 day' where id = ${inviteId}`;
      try {
        await expectDenied(() => upload(BORROWER, key(prefix, 21)));
      } finally {
        // expires_at is not terminal — extending is a legitimate staff action.
        await sql`update borrower_invites set expires_at = now() + interval '30 days' where id = ${inviteId}`;
      }
    });

    it("the object budget stops bucket flooding that row quotas would miss", async () => {
      await sql`update borrower_invites set max_docs = 3 where id = ${inviteId}`;
      try {
        // One object already exists from the first scenario.
        await upload(BORROWER, key(prefix, 30));
        await upload(BORROWER, key(prefix, 31));
        await expectDenied(() => upload(BORROWER, key(prefix, 32)));
      } finally {
        await sql`update borrower_invites set max_docs = null where id = ${inviteId}`;
      }
    });

    it("staff see their own AND their borrowers' uploads — never another tenant's", async () => {
      // Borrower objects live under the tenant prefix, so the EXISTING staff
      // policy already covers them: the lender reads what was uploaded for
      // them, which is the point of the portal. Asserted by predicate, not
      // by an exact count, so earlier scenarios can add objects freely.
      const rows = await asUser(sql, U.underwriterA, (tx) => tx`select name from storage.objects`);
      const names = rows.map((r) => (r as { name: string }).name);
      expect(names.every((n) => n.startsWith(`${TENANT_A}/`))).toBe(true);
      expect(names.some((n) => n.startsWith(`${TENANT_A}/deals/${DEAL_A}/uploads/`))).toBe(true);
      expect(names.some((n) => n.includes("/borrower-uploads/"))).toBe(true);
      expect(names.some((n) => n.startsWith(`${TENANT_B}/`))).toBe(false);

      // …and an org user matches NEITHER borrower policy (disjointness).
      const [row] = await asUser(
        sql,
        U.underwriterA,
        (tx) => tx`select public.has_borrower_invite() as b`,
      );
      expect((row as { b: boolean }).b).toBe(false);
    });
  });

  describe("claim flow + disjointness (M12.1 PR3)", () => {
    const INVITEE = "00000000-0000-4000-8000-0000000000f5";
    const ATTACKER = "00000000-0000-4000-8000-0000000000f6";
    const TOKEN = "a".repeat(64);
    let claimBorrowerId = "";
    let claimInviteId = "";

    beforeAll(async () => {
      await sql`insert into auth.users (id, email) values
        (${INVITEE}, 'invitee@borrower-test.dev'),
        (${ATTACKER}, 'attacker@evil.dev') on conflict (id) do nothing`;
      const [b] = await sql`insert into borrowers (tenant_id, full_name, email, created_by)
        values (${TENANT_A}, 'Real Invitee', 'invitee@borrower-test.dev', ${U.underwriterA})
        returning id`;
      claimBorrowerId = (b as { id: string }).id;
      const [inv] = await sql`insert into borrower_invites
        (tenant_id, deal_id, borrower_id, email, token_hash, display_label, invited_by, expires_at)
        values (${TENANT_A}, ${DEAL_A}, ${claimBorrowerId}, 'invitee@borrower-test.dev',
                encode(sha256(convert_to(${TOKEN},'utf8')),'hex'),
                'Alpha Deal', ${U.underwriterA}, now() + interval '30 days')
        returning id`;
      claimInviteId = (inv as { id: string }).id;
    });

    afterAll(async () => {
      await sql`delete from borrower_invites where id = ${claimInviteId}`;
    });

    const claim = (uid: string, token: string) =>
      asUser(sql, uid, (tx) => tx`select public.claim_borrower_invite(${token}) as id`);

    it("A LEAKED LINK IS WORTHLESS: the mailbox is the gate, not the token", async () => {
      // The whole security argument. An attacker who has the link and signs
      // in as themselves is refused — they are not the invitee.
      const err = await expectDenied(() => claim(ATTACKER, TOKEN));
      expect(err.message).toContain("different email address");
      const [row] =
        await sql`select auth_user_id from borrower_invites where id = ${claimInviteId}`;
      expect((row as { auth_user_id: string | null }).auth_user_id).toBeNull();
    });

    it("the real invitee claims it, and re-claiming is idempotent", async () => {
      const [first] = await claim(INVITEE, TOKEN);
      expect((first as { id: string }).id).toBe(claimInviteId);
      const [again] = await claim(INVITEE, TOKEN); // page refresh, retried link
      expect((again as { id: string }).id).toBe(claimInviteId);
    });

    it("a claimed invite is single-seat — nobody else can take it", async () => {
      await sql`update auth.users set email = 'invitee@borrower-test.dev' where id = ${ATTACKER}`;
      try {
        // Even with a matching email, the seat is already bound.
        const err = await expectDenied(() => claim(ATTACKER, TOKEN));
        expect(err.message).toContain("already been claimed");
      } finally {
        await sql`update auth.users set email = 'attacker@evil.dev' where id = ${ATTACKER}`;
      }
    });

    it("a bogus or revoked token reveals nothing beyond 'not found'", async () => {
      const err = await expectDenied(() => claim(ATTACKER, "b".repeat(64)));
      expect(err.message).toContain("not found");
    });

    it("DISJOINTNESS: an org member cannot claim a borrower invite", async () => {
      const err = await expectDenied(() => claim(U.underwriterA, TOKEN));
      expect(err.message).toContain("organization workspace");
    });

    it("DISJOINTNESS: a borrower cannot self-serve a workspace at /welcome", async () => {
      // Without this the borrower would hold a profiles row, current_tenant_id()
      // would stop being NULL for them, and every tenant policy would open.
      const err = await expectDenied(() =>
        asUser(
          sql,
          INVITEE,
          (tx) => tx`select public.create_organization('Borrower Co', 'solo_broker'::org_kind)`,
        ),
      );
      expect(err.message).toContain("borrower-portal account");
    });

    it("DISJOINTNESS: a borrower cannot accept a STAFF invite either", async () => {
      const staffToken = "c".repeat(64);
      await sql`insert into invites (tenant_id, email, role, token_hash, invited_by, expires_at)
        values (${TENANT_A}, 'invitee@borrower-test.dev', 'underwriter',
                encode(sha256(convert_to(${staffToken},'utf8')),'hex'),
                ${U.adminA}, now() + interval '7 days')`;
      const err = await expectDenied(() =>
        asUser(sql, INVITEE, (tx) => tx`select public.accept_invite(${staffToken})`),
      );
      expect(err.message).toContain("borrower-portal account");
    });

    it("portal state is CURATED — no deal status, no metrics, no other parties", async () => {
      const [row] = await asUser(
        sql,
        INVITEE,
        (tx) => tx`select public.borrower_portal_state() as s`,
      );
      const state = (row as { s: Record<string, unknown> }).s;
      expect(state["inviteId"]).toBe(claimInviteId);
      expect(state["label"]).toBe("Alpha Deal"); // the SNAPSHOT, not deals.name
      // The exact key set — anything new here is a deliberate decision.
      expect(Object.keys(state).sort()).toEqual([
        "entityLabel",
        "expiresAt",
        "inviteId",
        "items",
        "label",
        "requests",
        "status",
        "uploads",
      ]);
      // Curated status vocabulary only — never intake/parsing/review.
      expect(["collecting", "action_needed", "received", "in_review", "complete"]).toContain(
        state["status"],
      );
    });

    it("portal state returns NOTHING for an org user or an unclaimed stranger", async () => {
      for (const uid of [U.underwriterA, ATTACKER]) {
        const [row] = await asUser(
          sql,
          uid,
          (tx) => tx`select public.borrower_portal_state() as s`,
        );
        expect((row as { s: unknown }).s).toBeNull();
      }
    });

    it("attach_upload refuses an invite that is not yours, and fails CLOSED with no object", async () => {
      // Not your invite → refused outright.
      await expectDenied(() =>
        asUser(
          sql,
          ATTACKER,
          (tx) =>
            tx`select public.borrower_attach_upload(${claimInviteId}, ${"d".repeat(64)}, 'pdf', 'x.pdf')`,
        ),
      );
      // Your invite, but no finalized object → refuses rather than creating a
      // documents row that points at nothing.
      const err = await expectDenied(() =>
        asUser(
          sql,
          INVITEE,
          (tx) =>
            tx`select public.borrower_attach_upload(${claimInviteId}, ${"e".repeat(64)}, 'pdf', 'x.pdf')`,
        ),
      );
      expect(err.message).toContain("not finalized");
    });

    it("anon holds EXECUTE on none of the borrower definers", async () => {
      for (const sig of [
        "public.claim_borrower_invite(text)",
        "public.borrower_portal_state()",
        "public.borrower_attach_upload(uuid, text, text, text)",
        "public.current_invite_ids()",
      ]) {
        const [row] = await sql.unsafe(
          `select has_function_privilege('anon', '${sig}', 'EXECUTE') as ok`,
        );
        expect((row as { ok: boolean }).ok, sig).toBe(false);
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
