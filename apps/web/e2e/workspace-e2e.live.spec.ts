/**
 * M8.9 — the workspace demo flow against the LIVE stack: upload → spread →
 * override in the source viewer → in-request recompute → policy chips.
 * The deal pins the REAL seeded SOP pack (draft → advisory chips + badge).
 *
 * Gated on RUN_LIVE_E2E=1; CI always skips. Upload exercises the real
 * storage path; document PROCESSING stays pending until the Trigger.dev
 * task deploys (TRIGGER_ACCESS_TOKEN, [PRATIK]) — facts are seeded, as in
 * the M6.6 spec.
 */

import { expect, test } from "@playwright/test";
import { adminCreateUser, adminDeleteUser, live, runSql } from "./support/live-env";

const T = {
  // The REAL seeded pack (M2.6) — never deleted by this spec.
  packId: "00000000-0000-4000-9000-000000000001",
  tenantId: "00000000-0000-4000-c000-00000000000a",
  dealId: "00000000-0000-4000-c000-0000000000da",
  entityId: "00000000-0000-4000-c000-0000000000ea",
  periodId: "00000000-0000-4000-c000-00000000009a",
  scenarioId: "00000000-0000-4000-c000-00000000005a",
  factNi: "00000000-0000-4000-c000-0000000000f1",
};

const reviewerEmail = `workspace-e2e+${Date.now()}@credexis.test`;
const reviewerPassword = `pw-${crypto.randomUUID()}`;
let reviewerId: string | null = null;

const CLEANUP = `
  delete from public.computed_metrics where deal_id = '${T.dealId}';
  delete from public.issues where deal_id = '${T.dealId}';
  delete from public.addbacks where deal_id = '${T.dealId}';
  delete from public.facts where deal_id = '${T.dealId}';
  delete from public.loan_scenarios where deal_id = '${T.dealId}';
  delete from public.logical_documents where document_id in
    (select id from public.documents where deal_id = '${T.dealId}');
  delete from public.documents where deal_id = '${T.dealId}';
  delete from public.periods where tenant_id = '${T.tenantId}';
  delete from public.entities where deal_id = '${T.dealId}';
  delete from public.deals where id = '${T.dealId}';
  delete from public.profiles where tenant_id = '${T.tenantId}';
  -- audit purge LAST: the fact/addback/scenario deletes above fire the
  -- audit trigger and create fresh rows (M6.6 lesson).
  delete from public.audit_log where tenant_id = '${T.tenantId}';
  delete from public.tenants where id = '${T.tenantId}';
`;

/** NI $120k + bridge (interest 20k, tax 10k, D&A 30k) → CFADS $180k. */
const seedSql = (userId: string) => `
  insert into public.tenants (id, name) values ('${T.tenantId}', 'M8.9 E2E Tenant');
  insert into public.profiles (id, tenant_id, email, role)
    values ('${userId}', '${T.tenantId}', '${reviewerEmail}', 'underwriter');
  insert into public.deals (id, tenant_id, name, type, policy_pack_id)
    values ('${T.dealId}', '${T.tenantId}', 'M8.9 Workspace Deal', 'business_acquisition', '${T.packId}');
  insert into public.entities (id, tenant_id, deal_id, kind, name)
    values ('${T.entityId}', '${T.tenantId}', '${T.dealId}', 'target', 'Workspace Opco LLC');
  insert into public.periods (id, tenant_id, entity_id, kind, start_date, end_date, label)
    values ('${T.periodId}', '${T.tenantId}', '${T.entityId}', 'fiscal_year',
            '2023-01-01', '2023-12-31', 'FY2023');
  insert into public.facts
      (id, tenant_id, deal_id, entity_id, period_id, taxonomy_node_key,
       value_cents, method, confidence, status)
    values
      ('${T.factNi}', '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.net_income', 12000000, 'consensus', 0.95, 'accepted'),
      (gen_random_uuid(), '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.other.interest_expense', 2000000, 'consensus', 0.95, 'accepted'),
      (gen_random_uuid(), '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.income_tax', 1000000, 'consensus', 0.95, 'accepted'),
      (gen_random_uuid(), '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.opex.depreciation', 3000000, 'consensus', 0.95, 'accepted');
  insert into public.loan_scenarios
      (id, tenant_id, deal_id, name, amount_cents, rate_spec, term_months, structure)
    values ('${T.scenarioId}', '${T.tenantId}', '${T.dealId}', 'Base case', 35000000,
            '{"type":"fixed","bps":1025}', 120,
            '{"useOfProceeds":["business_acquisition"],"equityInjectionCents":"5000000","totalProjectCostCents":"40000000","sbaGuarantyBps":7500}');
`;

/** A tiny valid single-page PDF for the upload step. */
const MINIMAL_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
164
%%EOF`,
  "utf8",
);

test.describe("M8.9 workspace flow (live)", () => {
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

  test("upload → spread → override → recompute → policy chips", async ({ page }) => {
    test.setTimeout(180_000);

    // Sign in.
    await page.goto("/login");
    await page.getByLabel("Email").fill(reviewerEmail);
    await page.getByLabel("Password").fill(reviewerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // Dashboard shows the deal on the board.
    await page.goto("/");
    await expect(page.getByText("M8.9 Workspace Deal")).toBeVisible();

    // Upload a document through the real storage path.
    await page.goto(`/deals/${T.dealId}/documents`);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "test-upload.pdf", mimeType: "application/pdf", buffer: MINIMAL_PDF });
    await expect(page.getByText("✓ test-upload.pdf")).toBeVisible({ timeout: 20_000 });

    // Workspace: trigger a recompute by saving the scenario (engine runs
    // in-request), then read the strip.
    await page.goto(`/deals/${T.dealId}/workspace?scenario=${T.scenarioId}`);
    await expect(page.getByRole("heading", { name: "M8.9 Workspace Deal" })).toBeVisible();

    // The scenario tab → edit → save (no changes) → recompute fills metrics.
    await page.getByRole("button", { name: "Scenario" }).click();
    await page.getByRole("button", { name: "edit" }).first().click();
    await page.getByRole("button", { name: "Save scenario" }).click();
    await expect(page.getByLabel("metrics strip")).toContainText("$180,000.00", {
      timeout: 20_000,
    }); // CFADS

    // Policy chips render from the pinned (draft) pack: advisory badge + rules.
    await expect(page.getByLabel("policy compliance")).toBeVisible();
    await expect(page.getByText("DRAFT PACK — advisory only")).toBeVisible();

    // Spread: open the NI cell and override $120,000 → $200,000.
    const cell = page.getByRole("gridcell", { name: "$120,000.00" });
    await expect(cell).toBeVisible({ timeout: 15_000 });
    await cell.click();
    await expect(page.getByRole("complementary", { name: "inspector" })).toContainText(
      "is.net_income",
    );
    await page.getByLabel("Override value").fill("200,000.00");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Recompute happened in-request: CFADS strip moves 180k → 260k.
    await expect(page.getByLabel("metrics strip")).toContainText("$260,000.00", {
      timeout: 20_000,
    });

    // Banker workbook export (M10.1) responds with a real xlsx.
    const exportRes = await page.request.get(`/api/deals/${T.dealId}/export`);
    expect(exportRes.status()).toBe(200);
    expect(exportRes.headers()["content-type"]).toContain("spreadsheetml");
    expect((await exportRes.body()).length).toBeGreaterThan(5_000);

    // The override is a supersession in the DB, attributed to the reviewer.
    const factRes = await runSql(`
      select method, status, value_cents::text as v, created_by
      from public.facts
      where deal_id = '${T.dealId}' and taxonomy_node_key = 'is.net_income'
        and method = 'override';
    `);
    expect(factRes.ok).toBe(true);
    const rows = factRes.body as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "accepted", v: "20000000", created_by: reviewerId });
  });
});
