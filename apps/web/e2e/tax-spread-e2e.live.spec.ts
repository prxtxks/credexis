/**
 * M4.8 — Tax Spread tab against the LIVE stack: registry-keyed rows render
 * from seeded tax-form facts, including a REGISTRY-ONLY fact (null
 * taxonomy — the derived-AGI case the old NOT NULL silently dropped), and
 * an agreeing IRS transcript fact badges the cell.
 *
 * The seed INSERT itself exercises migration 0009 against the live DB: a
 * null-taxonomy row with a registry id must be accepted by the
 * facts_taxonomy_or_registry_check.
 *
 * Gated on RUN_LIVE_E2E=1; CI always skips. Facts are seeded via the
 * Management API (M6.6 pattern); the reviewer and every row are removed
 * after.
 */

import { expect, test } from "@playwright/test";
import { adminCreateUser, adminDeleteUser, live, runSql } from "./support/live-env";

const T = {
  // The REAL seeded pack (M2.6) — never deleted by this spec.
  packId: "00000000-0000-4000-9000-000000000001",
  tenantId: "00000000-0000-4000-c000-00000000010a",
  dealId: "00000000-0000-4000-c000-0000000001da",
  entityId: "00000000-0000-4000-c000-0000000001ea",
  periodId: "00000000-0000-4000-c000-00000000019a",
  factAgi: "00000000-0000-4000-c000-0000000001f1",
};

const reviewerEmail = `tax-spread-e2e+${Date.now()}@credexis.test`;
const reviewerPassword = `pw-${crypto.randomUUID()}`;
let reviewerId: string | null = null;

const CLEANUP = `
  delete from public.computed_metrics where deal_id = '${T.dealId}';
  delete from public.issues where deal_id = '${T.dealId}';
  delete from public.facts where deal_id = '${T.dealId}';
  delete from public.periods where tenant_id = '${T.tenantId}';
  delete from public.entities where deal_id = '${T.dealId}';
  delete from public.deals where id = '${T.dealId}';
  delete from public.profiles where tenant_id = '${T.tenantId}';
  -- audit purge LAST: the fact deletes above fire the audit trigger and
  -- create fresh rows (M6.6 lesson).
  delete from public.audit_log where tenant_id = '${T.tenantId}';
  delete from public.tenants where id = '${T.tenantId}';
`;

/**
 * 1040 FY2023: line 9 ($100k) − line 10 ($5k) = line 11 AGI ($95k) — the
 * registry relation holds, so the seed adds no G4 noise. AGI additionally
 * gets an AGREEING transcript fact → the ✓IRS badge.
 */
const seedSql = (userId: string) => `
  insert into public.tenants (id, name) values ('${T.tenantId}', 'M4.8 Tax Spread Tenant');
  insert into public.profiles (id, tenant_id, email, role)
    values ('${userId}', '${T.tenantId}', '${reviewerEmail}', 'underwriter');
  insert into public.deals (id, tenant_id, name, type, policy_pack_id)
    values ('${T.dealId}', '${T.tenantId}', 'M4.8 Tax Spread Deal', 'business_acquisition', '${T.packId}');
  insert into public.entities (id, tenant_id, deal_id, kind, name)
    values ('${T.entityId}', '${T.tenantId}', '${T.dealId}', 'guarantor', 'Pat Guarantor');
  insert into public.periods (id, tenant_id, entity_id, kind, start_date, end_date, label)
    values ('${T.periodId}', '${T.tenantId}', '${T.entityId}', 'fiscal_year',
            '2023-01-01', '2023-12-31', 'FY2023');
  insert into public.facts
      (id, tenant_id, deal_id, entity_id, period_id, taxonomy_node_key,
       registry_field_id, value_cents, method, confidence, status, source_transcript_line)
    values
      (gen_random_uuid(), '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'pcf.income.total', 'f1040.line9', 10000000, 'consensus', 0.95, 'accepted', null),
      (gen_random_uuid(), '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'pcf.outflow.other', 'f1040.line10', 500000, 'consensus', 0.95, 'accepted', null),
      -- REGISTRY-ONLY: null taxonomy + registry id → must pass the CHECK.
      ('${T.factAgi}', '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       null, 'f1040.line11', 9500000, 'consensus', 0.95, 'accepted', null),
      (gen_random_uuid(), '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       null, 'f1040.line11', 9500000, 'transcript', 1, 'accepted', 'f1040.line11');
`;

test.describe("M4.8 Tax Spread tab (live)", () => {
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

  test("registry rows render, derived AGI included, transcript badge, click-to-inspector", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Sign in.
    await page.goto("/login");
    await page.getByLabel("Email").fill(reviewerEmail);
    await page.getByLabel("Password").fill(reviewerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // Tax Spread tab.
    await page.goto(`/deals/${T.dealId}/workspace?tab=tax`);
    await expect(page.getByRole("heading", { name: "M4.8 Tax Spread Deal" })).toBeVisible();

    // Form-family header row + registry line rows with line numbers.
    await expect(page.getByText("Form 1040", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Total income", { exact: true })).toBeVisible();
    await expect(page.getByRole("gridcell", { name: "$100,000.00" })).toBeVisible();
    await expect(page.getByRole("gridcell", { name: "$5,000.00" })).toBeVisible();

    // The derived line (registry-only fact, null taxonomy) renders with its
    // chip — this row simply did not exist before M4.8.
    await expect(page.getByText("Adjusted gross income")).toBeVisible();
    await expect(page.getByText("derived", { exact: true })).toBeVisible();

    // Transcript agreement badges the AGI cell.
    await expect(page.getByRole("gridcell", { name: "$95,000.00 ✓IRS" })).toBeVisible();

    // Click-to-source: the inspector identifies the cell by registry id.
    await page.getByRole("gridcell", { name: "$95,000.00 ✓IRS" }).click();
    await expect(page.getByRole("complementary", { name: "inspector" })).toContainText(
      "f1040.line11",
    );

    await page.screenshot({ path: "test-results/tax-spread-live.png", fullPage: true });
  });
});
