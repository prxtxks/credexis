/**
 * The click-to-source HERO fixture, live: a fully synthetic 1120-S page for
 * the fictional "Workspace Opco LLC" is uploaded to storage (service key,
 * same content-addressed object key the app builds - see
 * src/lib/storage.ts uploadObjectKey) and the seeded facts carry REAL
 * document lineage (source_logical_document_id + source_page +
 * source_bbox pointing at values printed on that page). Clicking a spread
 * cell renders the PDF in the source viewer with the bounding box
 * highlighted - the marketing hero shot, with zero real data
 * (docs/HANDOFF.md bans real-deal screenshots).
 *
 * Gated on RUN_LIVE_E2E=1; CI always skips. SOURCE_DEMO_KEEP=1 skips the
 * teardown and prints the workspace URL + sign-in credentials so the deal
 * stays up for manual capture (pair with E2E_TARGET_URL to drive the
 * deployed UI instead of the dev server - dev builds draw the Next.js dev
 * badge into screenshots). The next run reseeds cleanly either way.
 * Teardown purges all data but keeps the empty tenant shell row - tenant
 * deletion is blocked by the audit trigger + FK (see CLEANUP comment).
 */

import { expect, test } from "@playwright/test";
import { adminCreateUser, adminDeleteUser, env, live, runSql } from "./support/live-env";
import { buildWorkspaceOpco1120s, type SyntheticFixture } from "./support/synthetic-1120s";

const T = {
  // The REAL seeded pack (M2.6) - never deleted by this spec.
  packId: "00000000-0000-4000-9000-000000000001",
  tenantId: "00000000-0000-4000-fd00-00000000000a",
  dealId: "00000000-0000-4000-fd00-0000000000da",
  entityId: "00000000-0000-4000-fd00-0000000000ea",
  periodId: "00000000-0000-4000-fd00-00000000009a",
  scenarioId: "00000000-0000-4000-fd00-00000000005a",
  documentId: "00000000-0000-4000-fd00-0000000000d0",
  logicalDocId: "00000000-0000-4000-fd00-0000000000d1",
  factNi: "00000000-0000-4000-fd00-0000000000f1",
};

const TENANT_NAME = "Credexis Demo (Synthetic)";

/**
 * Refuse to touch T.tenantId unless it is absent or OURS by name. A cute
 * fixed uuid is not proof of ownership: the f000 family looked free in the
 * repo but was Pratik's REAL live workspace tenant (2026-08-12) - only an
 * FK abort inside the implicit transaction kept CLEANUP from deleting his
 * profiles. Runs before ANY delete, in beforeAll and afterAll both.
 */
async function assertTenantIsOurs(): Promise<void> {
  const res = await runSql(`select name from public.tenants where id = '${T.tenantId}';`);
  const rows = (res.body as { name: string }[]) ?? [];
  const name = rows[0]?.name;
  if (name !== undefined && name !== TENANT_NAME) {
    throw new Error(
      `tenant ${T.tenantId} already exists as "${name}" - id collision with real data; ` +
        `refusing to seed or clean. Pick a new uuid family for this spec.`,
    );
  }
}

/** Fixed identity so KEEP mode is re-runnable; stale users are deleted by
 *  email lookup in beforeAll. The password is fresh per run and printed
 *  only in KEEP mode (throwaway demo account on the synthetic tenant). */
const DEMO_EMAIL = "source-demo@credexis.test";
const demoPassword = `pw-${crypto.randomUUID()}`;
let demoUserId: string | null = null;
let fixture: SyntheticFixture;

const CLEANUP = `
  delete from public.computed_metrics where deal_id = '${T.dealId}';
  delete from public.issues where deal_id = '${T.dealId}';
  delete from public.addbacks where deal_id = '${T.dealId}';
  delete from public.facts where deal_id = '${T.dealId}';
  delete from public.loan_scenarios where deal_id = '${T.dealId}';
  delete from public.extraction_runs where deal_id = '${T.dealId}';
  -- pages/identities before logical_documents (FK), as in the M8.9 spec.
  delete from public.pages where tenant_id = '${T.tenantId}';
  delete from public.document_identities where tenant_id = '${T.tenantId}';
  delete from public.logical_documents where document_id in
    (select id from public.documents where deal_id = '${T.dealId}');
  delete from public.documents where deal_id = '${T.dealId}';
  delete from public.periods where tenant_id = '${T.tenantId}';
  delete from public.entities where deal_id = '${T.dealId}';
  delete from public.deals where id = '${T.dealId}';
  delete from public.profiles where tenant_id = '${T.tenantId}';
  -- audit purge LAST: the deletes above fire the audit trigger (M6.6 lesson).
  delete from public.audit_log where tenant_id = '${T.tenantId}';
  -- The tenants row is deliberately KEPT (empty shell, no members, RLS
  -- keeps it invisible): deleting a tenant is impossible since 0020 - the
  -- tenants_audit trigger inserts an audit row referencing the tenant
  -- mid-delete and the audit_log FK (non-deferrable, no cascade) aborts
  -- the statement. The shell also anchors assertTenantIsOurs across runs.
`;

/** Same object-key scheme as src/lib/storage.ts uploadObjectKey. */
const storagePath = (sha256: string) => `${T.tenantId}/deals/${T.dealId}/uploads/${sha256}.pdf`;

/**
 * NI $120k + bridge (interest 20k, tax 10k, D&A 30k) -> CFADS $180k, the
 * M8.9 numbers - but here every fact points at a value PRINTED on the
 * uploaded synthetic PDF (Iron Law #1: numbers trace to a source bbox).
 */
const seedSql = (userId: string, fx: SyntheticFixture) => {
  const factRows = fx.facts
    .map((f) => {
      const id = f.registryFieldId === "f1120s.line21" ? `'${T.factNi}'` : "gen_random_uuid()";
      return `(${id}, '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       '${f.taxonomyNodeKey}', '${f.registryFieldId}', ${f.valueCents}, 'consensus',
       ${f.confidence}, 'accepted', '${T.logicalDocId}', ${f.sourcePage},
       '${JSON.stringify(f.bbox)}'::jsonb)`;
    })
    .join(",\n      ");
  return `
  insert into public.tenants (id, name) values ('${T.tenantId}', '${TENANT_NAME}')
    on conflict (id) do nothing; -- the kept shell from a previous run
  insert into public.profiles (id, tenant_id, email, role)
    values ('${userId}', '${T.tenantId}', '${DEMO_EMAIL}', 'underwriter');
  insert into public.deals (id, tenant_id, name, type, policy_pack_id)
    values ('${T.dealId}', '${T.tenantId}', 'Workspace Opco Acquisition', 'business_acquisition', '${T.packId}');
  insert into public.entities (id, tenant_id, deal_id, kind, name)
    values ('${T.entityId}', '${T.tenantId}', '${T.dealId}', 'target', 'Workspace Opco LLC');
  insert into public.periods (id, tenant_id, entity_id, kind, start_date, end_date, label)
    values ('${T.periodId}', '${T.tenantId}', '${T.entityId}', 'fiscal_year',
            '${fx.taxYear}-01-01', '${fx.taxYear}-12-31', 'FY${fx.taxYear}');
  insert into public.documents
      (id, tenant_id, deal_id, file_name, storage_path, sha256, bytes, mime_type,
       virus_scan, status, uploaded_by)
    values ('${T.documentId}', '${T.tenantId}', '${T.dealId}', '${fx.fileName}',
            '${storagePath(fx.sha256)}', '${fx.sha256}', ${fx.pdf.byteLength},
            'application/pdf', 'clean', 'processed', '${userId}');
  insert into public.logical_documents
      (id, tenant_id, document_id, entity_id, entity_confirmed, form_family,
       tax_year, page_start, page_end)
    values ('${T.logicalDocId}', '${T.tenantId}', '${T.documentId}', '${T.entityId}',
            true, '${fx.formFamily}', ${fx.taxYear}, 1, ${fx.pageCount});
  insert into public.facts
      (id, tenant_id, deal_id, entity_id, period_id, taxonomy_node_key,
       registry_field_id, value_cents, method, confidence, status,
       source_logical_document_id, source_page, source_bbox)
    values
      ${factRows};
  insert into public.loan_scenarios
      (id, tenant_id, deal_id, name, amount_cents, rate_spec, term_months, structure)
    values ('${T.scenarioId}', '${T.tenantId}', '${T.dealId}', 'Base case', 35000000,
            '{"type":"fixed","bps":1025}', 120,
            '{"useOfProceeds":["business_acquisition"],"equityInjectionCents":"5000000","totalProjectCostCents":"40000000","sbaGuarantyBps":7500}');
`;
};

/** Direct storage write (service key), as in pipeline-verify's cleanup path.
 *  x-upsert makes re-runs idempotent even after a kept prior run. */
async function uploadPdf(path: string, bytes: Buffer): Promise<void> {
  const res = await fetch(`${env.supabaseUrl}/storage/v1/object/deal-documents/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey ?? "",
      "Content-Type": "application/pdf",
      "x-upsert": "true",
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`storage upload failed (${res.status}): ${await res.text()}`);
}

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

/** Delete any auth user left by a previous KEEP run (fixed demo email). */
async function deleteStaleDemoUsers(): Promise<void> {
  const res = await runSql(`select id from auth.users where email = '${DEMO_EMAIL}';`);
  const ids = ((res.body as { id: string }[]) ?? []).map((r) => r.id);
  for (const id of ids) await adminDeleteUser(id);
}

test.describe("source-demo hero fixture (live)", () => {
  test.skip(!live, "needs RUN_LIVE_E2E=1 + Supabase credentials in .env.local");
  test.describe.configure({ mode: "serial" });
  // Hero-shot geometry: roomy viewport, retina scale for crisp capture.
  test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

  test.beforeAll(async () => {
    await assertTenantIsOurs(); // BEFORE any delete - see the helper's story
    await deleteStorageObjects(); // needs the documents rows, so before CLEANUP
    await runSql(CLEANUP);
    await deleteStaleDemoUsers();
    demoUserId = await adminCreateUser(DEMO_EMAIL, demoPassword);
    fixture = await buildWorkspaceOpco1120s();
    await uploadPdf(storagePath(fixture.sha256), fixture.pdf);
    const seeded = await runSql(seedSql(demoUserId, fixture));
    expect(seeded.ok, JSON.stringify(seeded.body)).toBe(true);
  });

  test.afterAll(async () => {
    if (process.env["SOURCE_DEMO_KEEP"] === "1") {
      // Throwaway demo credentials, printed on purpose for manual capture.
      console.log(
        `[source-demo] kept for manual capture:\n` +
          `  workspace: /deals/${T.dealId}/workspace?scenario=${T.scenarioId}\n` +
          `  sign-in:   ${DEMO_EMAIL} / ${demoPassword}\n` +
          `  reseed or clean up by re-running this spec (without SOURCE_DEMO_KEEP).`,
      );
      return;
    }
    await assertTenantIsOurs();
    await deleteStorageObjects();
    const cleaned = await runSql(CLEANUP);
    expect(cleaned.ok, JSON.stringify(cleaned.body)).toBe(true);
    if (demoUserId) await adminDeleteUser(demoUserId);
  });

  test("click NI cell → synthetic 1120-S renders with the bbox on 120,000.00", async ({ page }) => {
    test.setTimeout(180_000);

    // Sign in.
    await page.goto("/login");
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // Workspace; scenario save triggers the in-request recompute (M8.9
    // trick) so the metrics strip is populated for the shot.
    await page.goto(`/deals/${T.dealId}/workspace?scenario=${T.scenarioId}`);
    await expect(page.getByRole("heading", { name: "Workspace Opco Acquisition" })).toBeVisible();
    await page.getByRole("button", { name: "Scenario" }).click();
    await page.getByRole("button", { name: "edit" }).first().click();
    await page.getByRole("button", { name: "Save scenario" }).click();
    await expect(page.getByLabel("metrics strip")).toContainText("$180,000.00", {
      timeout: 20_000,
    }); // CFADS

    // Click the seeded NI cell: the inspector resolves full lineage.
    const cell = page.getByRole("gridcell", { name: "$120,000.00" });
    await expect(cell).toBeVisible({ timeout: 15_000 });
    await cell.click();
    const inspector = page.getByRole("complementary", { name: "inspector" });
    await expect(inspector).toContainText("f1120s.line21");
    await expect(inspector).toContainText(fixture.fileName);
    await expect(inspector).toContainText("1120S 2023");

    // The synthetic PDF actually rendered (pdf.js canvas has real size)...
    const canvas = inspector.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await canvas.boundingBox())?.height ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(100);

    // ...with the highlight ON the printed 120,000.00: the marker's center
    // must sit within 2% of the seeded bbox center, in page fractions.
    const marker = inspector.getByLabel("source bounding box");
    await expect(marker).toBeVisible();
    const ni = fixture.facts.find((f) => f.registryFieldId === "f1120s.line21")!;
    const c = (await canvas.boundingBox())!;
    const m = (await marker.boundingBox())!;
    const centerX = (m.x + m.width / 2 - c.x) / c.width;
    const centerY = (m.y + m.height / 2 - c.y) / c.height;
    expect(Math.abs(centerX - (ni.bbox.x + ni.bbox.w / 2))).toBeLessThan(0.02);
    expect(Math.abs(centerY - (ni.bbox.y + ni.bbox.h / 2))).toBeLessThan(0.02);

    // Hero capture: highlight scrolled into view, whole workspace framed,
    // and no "Scenario saved" toast photobombing the corner.
    await marker.scrollIntoViewIfNeeded();
    await expect(page.getByText("Scenario saved")).toBeHidden({ timeout: 15_000 });
    await page.screenshot({ path: "e2e/screenshots/source-viewer-hero.png" });
  });
});
