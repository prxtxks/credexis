/**
 * M9 exit gate, live: a demo deal shows the "verified by IRS transcript"
 * badge on a matching cell AND a planted parsed-vs-transcript mismatch
 * surfaced as a critical G5 tamper flag in the issues panel.
 *
 * Transcript facts are seeded directly (the ingest mapper is unit-tested;
 * no provider is configured yet - M9.1). Gated on RUN_LIVE_E2E=1.
 */

import { expect, test } from "@playwright/test";
import { adminCreateUser, adminDeleteUser, live, runSql } from "./support/live-env";

const T = {
  packId: "00000000-0000-4000-9000-000000000001", // real seeded pack - never deleted
  tenantId: "00000000-0000-4000-d000-00000000000a",
  dealId: "00000000-0000-4000-d000-0000000000da",
  entityId: "00000000-0000-4000-d000-0000000000ea",
  periodId: "00000000-0000-4000-d000-00000000009a",
};

const reviewerEmail = `transcripts-e2e+${Date.now()}@credexis.test`;
const reviewerPassword = `pw-${crypto.randomUUID()}`;
let reviewerId: string | null = null;

const CLEANUP = `
  delete from public.computed_metrics where deal_id = '${T.dealId}';
  delete from public.issues where deal_id = '${T.dealId}';
  delete from public.transcript_consents where deal_id = '${T.dealId}';
  delete from public.facts where deal_id = '${T.dealId}';
  delete from public.periods where tenant_id = '${T.tenantId}';
  delete from public.entities where deal_id = '${T.dealId}';
  delete from public.deals where id = '${T.dealId}';
  delete from public.profiles where tenant_id = '${T.tenantId}';
  delete from public.audit_log where tenant_id = '${T.tenantId}';
  -- tenants_audit (migration 0013) fires AFTER DELETE and inserts an audit
  -- row for the tenant that no longer exists - FK 23503, and the whole
  -- cleanup transaction rolls back. Disable it around the final delete
  -- (transactional DDL: a failure re-enables it via rollback).
  alter table public.tenants disable trigger tenants_audit;
  delete from public.tenants where id = '${T.tenantId}';
  alter table public.tenants enable trigger tenants_audit;
`;

/**
 * Parsed NI $120,000 + transcript NI $120,000 (MATCH → badge);
 * parsed interest $20,000 + transcript interest $25,000 (MISMATCH → G5).
 */
const seedSql = (userId: string) => `
  insert into public.tenants (id, name) values ('${T.tenantId}', 'M9 E2E Tenant');
  insert into public.profiles (id, tenant_id, email, role)
    values ('${userId}', '${T.tenantId}', '${reviewerEmail}', 'underwriter');
  insert into public.deals (id, tenant_id, name, type, policy_pack_id, transcripts_enabled)
    values ('${T.dealId}', '${T.tenantId}', 'M9 Transcript Deal', 'business_acquisition',
            '${T.packId}', true);
  insert into public.entities (id, tenant_id, deal_id, kind, name)
    values ('${T.entityId}', '${T.tenantId}', '${T.dealId}', 'target', 'Transcript Opco LLC');
  insert into public.periods (id, tenant_id, entity_id, kind, start_date, end_date, label)
    values ('${T.periodId}', '${T.tenantId}', '${T.entityId}', 'fiscal_year',
            '2023-01-01', '2023-12-31', 'FY2023');
  insert into public.facts
      (tenant_id, deal_id, entity_id, period_id, taxonomy_node_key, registry_field_id,
       value_cents, method, confidence, status, source_transcript_line)
    values
      ('${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.net_income', 'f1120s.line21', 12000000, 'consensus', 0.95, 'accepted', null),
      ('${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.net_income', 'f1120s.line21', 12000000, 'transcript', 1, 'accepted', 'f1120s.line21'),
      ('${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.other.interest_expense', 'f1120s.line13', 2000000, 'consensus', 0.95, 'accepted', null),
      ('${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.other.interest_expense', 'f1120s.line13', 2500000, 'transcript', 1, 'accepted', 'f1120s.line13');
`;

test.describe("M9 transcript verification (live)", () => {
  test.skip(!live, "needs RUN_LIVE_E2E=1 + Supabase credentials in .env.local");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await runSql(CLEANUP);
    reviewerId = await adminCreateUser(reviewerEmail, reviewerPassword);
    const seeded = await runSql(seedSql(reviewerId));
    expect(seeded.ok, JSON.stringify(seeded.body)).toBe(true);
  });

  test.afterAll(async () => {
    const cleaned = await runSql(CLEANUP);
    expect(cleaned.ok, JSON.stringify(cleaned.body)).toBe(true);
    if (reviewerId) await adminDeleteUser(reviewerId);
  });

  test("verified badge on the matching cell; tamper flag on the mismatch", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/login");
    await page.getByLabel("Email").fill(reviewerEmail);
    await page.getByLabel("Password").fill(reviewerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto(`/deals/${T.dealId}/workspace`);
    await expect(page.getByRole("heading", { name: "M9 Transcript Deal" })).toBeVisible();

    // The transcript rail section is on (per-deal flag seeded true).
    await expect(page.getByRole("heading", { name: "IRS transcripts" })).toBeVisible();

    // Verified badge: parsed NI and the transcript agree exactly.
    await expect(page.getByRole("gridcell", { name: "$120,000.00 ✓IRS" })).toBeVisible({
      timeout: 15_000,
    });

    // The mismatched interest cell carries NO badge - G5 owns disagreements.
    await expect(page.getByRole("gridcell", { name: "$25,000.00", exact: true })).toBeVisible();

    // Run the engine + gates explicitly, then open the issues tab.
    await page.getByRole("button", { name: "Recompute" }).click();
    await page.getByRole("button", { name: /Issues/ }).click();
    await expect(page.getByRole("complementary", { name: "inspector" })).toContainText(
      "contradicts the IRS transcript",
      { timeout: 30_000 },
    );
    await expect(page.getByRole("complementary", { name: "inspector" })).toContainText("critical");
    await expect(page.getByRole("complementary", { name: "inspector" })).toContainText("G5");
  });
});
