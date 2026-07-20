/**
 * M3.1 exit proof, live: a REAL document uploaded through the UI is
 * processed by the DEPLOYED Trigger.dev pipeline — status uploaded →
 * processing → processed, logical_documents split/classified, one
 * extraction_run per stage. Point E2E_TARGET_URL at production to verify
 * the deployed stack end-to-end.
 *
 * Uses a consented real business return (25-page 1120-S). Gated on
 * RUN_LIVE_E2E=1; seeds and the reviewer are removed after; the storage
 * object is deleted through the storage API (service key — cleanup only).
 */

import { expect, test } from "@playwright/test";
import { adminCreateUser, adminDeleteUser, env, live, runSql } from "./support/live-env";

const T = {
  packId: "00000000-0000-4000-9000-000000000001", // real seeded pack — never deleted
  tenantId: "00000000-0000-4000-e000-00000000000a",
  dealId: "00000000-0000-4000-e000-0000000000da",
  entityId: "00000000-0000-4000-e000-0000000000ea",
};

const PDF_PATH =
  "/Users/ghostface/Credexis/docs/testing-docs/Credexis/Sample Folders by Name/Rimpal Patel Folder/Business Tax Returns/2023.pdf";

const uploaderEmail = `pipeline-verify+${Date.now()}@credexis.test`;
const uploaderPassword = `pw-${crypto.randomUUID()}`;
let uploaderId: string | null = null;

const CLEANUP = `
  delete from public.computed_metrics where deal_id = '${T.dealId}';
  delete from public.issues where deal_id = '${T.dealId}';
  delete from public.facts where deal_id = '${T.dealId}';
  delete from public.periods where tenant_id = '${T.tenantId}';
  delete from public.extraction_runs where deal_id = '${T.dealId}';
  delete from public.pages where tenant_id = '${T.tenantId}';
  delete from public.logical_documents where tenant_id = '${T.tenantId}';
  delete from public.documents where deal_id = '${T.dealId}';
  delete from public.entities where deal_id = '${T.dealId}';
  delete from public.deals where id = '${T.dealId}';
  delete from public.profiles where tenant_id = '${T.tenantId}';
  delete from public.audit_log where tenant_id = '${T.tenantId}';
  delete from public.tenants where id = '${T.tenantId}';
`;

const seedSql = (userId: string) => `
  insert into public.tenants (id, name) values ('${T.tenantId}', 'Pipeline Verify Tenant');
  insert into public.profiles (id, tenant_id, email, role)
    values ('${userId}', '${T.tenantId}', '${uploaderEmail}', 'underwriter');
  insert into public.deals (id, tenant_id, name, type, policy_pack_id)
    values ('${T.dealId}', '${T.tenantId}', 'Pipeline Verify Deal', 'business_acquisition', '${T.packId}');
  insert into public.entities (id, tenant_id, deal_id, kind, name)
    values ('${T.entityId}', '${T.tenantId}', '${T.dealId}', 'target', 'Shiv Ganesh LLC');
`;

/** Cleanup-only storage delete (service key; RLS keeps runtime paths clean). */
async function deleteStorageObjects(): Promise<void> {
  const res = await runSql(
    `select storage_path from public.documents where deal_id = '${T.dealId}';`,
  );
  const paths = ((res.body as { storage_path: string }[]) ?? []).map((r) => r.storage_path);
  for (const path of paths) {
    await fetch(`${env.supabaseUrl}/storage/v1/object/deal-documents/${path}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.serviceRoleKey}`,
        apikey: env.serviceRoleKey ?? "",
      },
    });
  }
}

test.describe("M3.1 deployed pipeline (live)", () => {
  test.skip(!live, "needs RUN_LIVE_E2E=1 + Supabase credentials in .env.local");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await runSql(CLEANUP);
    uploaderId = await adminCreateUser(uploaderEmail, uploaderPassword);
    const seeded = await runSql(seedSql(uploaderId));
    expect(seeded.ok, JSON.stringify(seeded.body)).toBe(true);
  });

  test.afterAll(async () => {
    await deleteStorageObjects(); // before the documents rows disappear
    await runSql(CLEANUP);
    if (uploaderId) await adminDeleteUser(uploaderId);
  });

  test("real 25-page return: upload → deployed task → processed + split", async ({ page }) => {
    test.setTimeout(900_000);

    await page.goto("/login");
    await page.getByLabel("Email").fill(uploaderEmail);
    await page.getByLabel("Password").fill(uploaderPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });

    await page.goto(`/deals/${T.dealId}/documents`);
    await page.locator('input[type="file"]').setInputFiles(PDF_PATH);
    await expect(page.getByText("✓ 2023.pdf")).toBeVisible({ timeout: 30_000 });

    // The deployed worker takes it from here: poll the DB, not the UI —
    // this proves the TASK ran, not that the page refreshed.
    await expect
      .poll(
        async () => {
          const res = await runSql(
            `select status from public.documents where deal_id = '${T.dealId}' limit 1;`,
          );
          return (res.body as { status: string }[])[0]?.status ?? "missing";
        },
        {
          message:
            "document never reached 'processed' — is the PROD secret key in the web app env?",
          timeout: 240_000,
          intervals: [5_000],
        },
      )
      .toBe("processed");

    // Split/classify wrote real logical documents from the real return.
    const ld = await runSql(`
      select form_family, tax_year, page_start, page_end
      from public.logical_documents where tenant_id = '${T.tenantId}'
      order by page_start;
    `);
    const spans = ld.body as { form_family: string; tax_year: number | null }[];
    expect(spans.length).toBeGreaterThanOrEqual(1);
    expect(spans.map((s) => s.form_family)).toContain("1120S");

    // One extraction_run per stage, both succeeded, page count = 25.
    const runs = await runSql(`
      select stage, status, page_count from public.extraction_runs
      where deal_id = '${T.dealId}' order by started_at;
    `);
    const runRows = runs.body as { stage: string; status: string; page_count: number | null }[];
    // Extraction (M4.5) appends its own rows behind these — assert the
    // ingest stages specifically, not the whole list.
    const ingestRuns = runRows.filter((r) => r.stage === "ingest" || r.stage === "split_classify");
    expect(ingestRuns.map((r) => [r.stage, r.status])).toEqual([
      ["ingest", "succeeded"],
      ["split_classify", "succeeded"],
    ]);
    expect(ingestRuns[1]!.page_count).toBe(25);

    // Extraction stage (M4.5): facts landed from the real return, with
    // registry lineage. Both vendor paths ran live — poll generously.
    await expect
      .poll(
        async () => {
          const res = await runSql(
            `select count(*)::int as n from public.facts where deal_id = '${T.dealId}';`,
          );
          return (res.body as { n: number }[])[0]?.n ?? 0;
        },
        { message: "no facts extracted", timeout: 480_000, intervals: [15_000] },
      )
      .toBeGreaterThan(3);

    const factsRes = await runSql(`
      select registry_field_id, method, status, count(*)::int as n
      from public.facts where deal_id = '${T.dealId}'
      group by registry_field_id, method, status order by registry_field_id limit 50;
    `);
    const factRows = factsRes.body as { registry_field_id: string | null; method: string }[];
    expect(factRows.some((f) => f.registry_field_id?.startsWith("f1120s."))).toBe(true);

    const runsRes2 = await runSql(`
      select stage, status from public.extraction_runs
      where deal_id = '${T.dealId}' and stage like 'extract%';
    `);
    const extractRuns = runsRes2.body as { stage: string; status: string }[];
    expect(extractRuns.length).toBeGreaterThanOrEqual(2); // both paths recorded

    // And the UI shows the outcome (stage chips + processed status).
    await page.reload();
    await expect(page.getByText("split_classify")).toBeVisible({ timeout: 15_000 });
  });
});
