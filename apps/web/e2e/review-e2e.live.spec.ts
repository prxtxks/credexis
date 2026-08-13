/**
 * M6.6 - the full review loop against the LIVE stack: seeded deal with a
 * planted G1 disagreement → real reviewer signs in and resolves it through
 * the keyboard-first UI → facts finalized (accept + supersession) → gate
 * engine re-run comes back green → every mutation audited with the actor.
 *
 * Gated on RUN_LIVE_E2E=1 + live credentials in .env.local - never in CI.
 * Everything seeded is removed in afterAll; the reviewer user is created
 * through GoTrue's admin API (so password sign-in works) and deleted after.
 */

import { expect, test } from "@playwright/test";
import { DEFAULT_GATE_CONFIG, runGates, type GateFact } from "@credexis/engine";
import { TAXONOMY_V1 } from "@credexis/schema";
import { adminCreateUser, adminDeleteUser, live, runSql } from "./support/live-env";

const T = {
  packId: "00000000-0000-4000-b000-000000000001",
  tenantId: "00000000-0000-4000-b000-00000000000a",
  dealId: "00000000-0000-4000-b000-0000000000da",
  entityId: "00000000-0000-4000-b000-0000000000ea",
  periodId: "00000000-0000-4000-b000-00000000009a",
  factSales: "00000000-0000-4000-b000-0000000000f1",
  factTotal: "00000000-0000-4000-b000-0000000000f2",
  issueId: "00000000-0000-4000-b000-000000000051",
};

/** Planted values: items sum $100,000.00 but the suggested total is $90,000.00. */
const SALES_CENTS = "10000000";
const WRONG_TOTAL_CENTS = "9000000";
const CORRECTED_TOTAL_DOLLARS = "100,000.00";

const reviewerEmail = `reviewer-e2e+${Date.now()}@credexis.test`;
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
  -- LAST among tenant-referencing rows: deleting facts above FIRES the
  -- audit trigger, creating fresh audit_log rows - purging audit_log any
  -- earlier leaves those behind and the tenants delete hits the FK.
  delete from public.audit_log where tenant_id = '${T.tenantId}';
  -- tenants_audit (migration 0013) fires AFTER DELETE and inserts an audit
  -- row for the tenant that no longer exists - FK 23503, and the whole
  -- cleanup transaction rolls back. Disable it around the final delete
  -- (transactional DDL: a failure re-enables it via rollback).
  alter table public.tenants disable trigger tenants_audit;
  delete from public.tenants where id = '${T.tenantId}';
  alter table public.tenants enable trigger tenants_audit;
  delete from public.policy_packs where id = '${T.packId}';
`;

const seedSql = (userId: string) => `
  insert into public.policy_packs (id, version, effective_date, rules)
    values ('${T.packId}', 'test-pack-m66', '2026-03-01', '{}');
  insert into public.tenants (id, name) values ('${T.tenantId}', 'M6.6 E2E Tenant');
  insert into public.profiles (id, tenant_id, email, role)
    values ('${userId}', '${T.tenantId}', '${reviewerEmail}', 'underwriter');
  insert into public.deals (id, tenant_id, name, type, policy_pack_id)
    values ('${T.dealId}', '${T.tenantId}', 'M6.6 E2E Deal', 'business_acquisition', '${T.packId}');
  insert into public.entities (id, tenant_id, deal_id, kind, name)
    values ('${T.entityId}', '${T.tenantId}', '${T.dealId}', 'target', 'Planted Disagreement LLC');
  insert into public.periods (id, tenant_id, entity_id, kind, start_date, end_date, label)
    values ('${T.periodId}', '${T.tenantId}', '${T.entityId}', 'fiscal_year',
            '2023-01-01', '2023-12-31', 'FY2023');
  insert into public.facts
      (id, tenant_id, deal_id, entity_id, period_id, taxonomy_node_key,
       value_cents, method, confidence, status)
    values
      ('${T.factSales}', '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.revenue.product_sales', ${SALES_CENTS}, 'consensus', 0.94, 'suggested'),
      ('${T.factTotal}', '${T.tenantId}', '${T.dealId}', '${T.entityId}', '${T.periodId}',
       'is.revenue.total', ${WRONG_TOTAL_CENTS}, 'consensus', 0.51, 'suggested');
  insert into public.issues (id, tenant_id, deal_id, gate, severity, fact_ids, message)
    values ('${T.issueId}', '${T.tenantId}', '${T.dealId}', 'G1', 'error',
            array['${T.factSales}','${T.factTotal}']::uuid[],
            'is.revenue.total ≠ Σ(is.revenue items): off by 1000000¢');
`;

/** Fetch the deal's live facts and run the gate engine over them. */
async function runGatesOverDeal() {
  const res = await runSql(`
    select f.id, f.entity_id, p.label, f.taxonomy_node_key, f.registry_field_id,
           f.value_cents::text as value_cents, f.method, f.status,
           f.source_logical_document_id
    from public.facts f
    join public.periods p on p.id = f.period_id
    where f.deal_id = '${T.dealId}';
  `);
  expect(res.ok, JSON.stringify(res.body)).toBe(true);
  const rows = res.body as Record<string, unknown>[];
  const facts: GateFact[] = rows.map((r) => ({
    id: r["id"] as string,
    entityId: r["entity_id"] as string,
    periodLabel: r["label"] as string,
    taxonomyNodeKey: (r["taxonomy_node_key"] as string | null) ?? null,
    registryFieldId: (r["registry_field_id"] as string | null) ?? null,
    valueCents: BigInt(r["value_cents"] as string),
    method: r["method"] as GateFact["method"],
    status: r["status"] as GateFact["status"],
    logicalDocumentId: (r["source_logical_document_id"] as string | null) ?? null,
  }));
  return runGates(facts, {
    ...DEFAULT_GATE_CONFIG,
    taxonomy: TAXONOMY_V1.map((n) => ({ key: n.key, parentKey: n.parentKey })),
    registryRelations: [],
    registryFlows: [],
  });
}

test.describe("M6.6 review loop (live)", () => {
  test.skip(!live, "needs RUN_LIVE_E2E=1 + Supabase credentials in .env.local");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await runSql(CLEANUP); // idempotent pre-clean of a crashed prior run
    reviewerId = await adminCreateUser(reviewerEmail, reviewerPassword);
    const seeded = await runSql(seedSql(reviewerId));
    expect(seeded.ok, JSON.stringify(seeded.body)).toBe(true);
  });

  test.afterAll(async () => {
    // Assert - a silently failing cleanup leaves rows that dup-break the
    // NEXT run's seed (exactly how the audit-trigger ordering bug surfaced).
    const cleaned = await runSql(CLEANUP);
    expect(cleaned.ok, JSON.stringify(cleaned.body)).toBe(true);
    if (reviewerId) await adminDeleteUser(reviewerId);
  });

  test("planted disagreement → reviewer resolves in UI → gates green", async ({ page }) => {
    test.setTimeout(180_000);

    // 1. The plant is real: the engine sees a blocking G1 before review.
    const before = await runGatesOverDeal();
    const g1 = before.issues.find((i) => i.gate === "G1");
    expect(g1?.blocking).toBe(true);
    expect(before.blockedFactIds.has(T.factTotal)).toBe(true);

    // 2. The reviewer signs in - a real GoTrue session, no shortcuts.
    await page.goto("/login");
    await page.getByLabel("Email").fill(reviewerEmail);
    await page.getByLabel("Password").fill(reviewerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    // 3. Work the queue: accept the clean item, correct the wrong total.
    await page.goto(`/deals/${T.dealId}/review`);
    const clearHeading = page.getByRole("heading", { name: /Queue clear/ });
    for (let i = 0; i < 4 && !(await clearHeading.isVisible()); i++) {
      const key = await page.locator("main section code").first().textContent();
      if (key === "is.revenue.total") {
        await page.getByRole("button", { name: "correct", exact: true }).click();
        await page.locator("#correction").fill(CORRECTED_TOTAL_DOLLARS);
        await page.keyboard.press("Enter");
      } else {
        await page.getByRole("button", { name: "accept", exact: true }).click();
      }
      await expect(async () => {
        const cleared = await clearHeading.isVisible();
        const now = cleared ? null : await page.locator("main section code").first().textContent();
        expect(cleared || now !== key).toBe(true);
      }).toPass({ timeout: 15_000 });
    }
    await expect(clearHeading).toBeVisible();

    // 4. Facts finalized: nothing suggested; supersession chain intact.
    const factsRes = await runSql(`
      select id, status, method, value_cents::text as value_cents,
             superseded_by, created_by
      from public.facts where deal_id = '${T.dealId}' order by created_at;
    `);
    expect(factsRes.ok).toBe(true);
    const rows = factsRes.body as Record<string, unknown>[];
    expect(rows.filter((r) => r["status"] === "suggested")).toHaveLength(0);

    const sales = rows.find((r) => r["id"] === T.factSales);
    expect(sales?.["status"]).toBe("accepted");

    const original = rows.find((r) => r["id"] === T.factTotal);
    expect(original?.["status"]).toBe("overridden");
    const override = rows.find((r) => r["id"] === original?.["superseded_by"]);
    expect(override).toMatchObject({
      method: "override",
      status: "accepted",
      value_cents: SALES_CENTS, // corrected to match Σ items exactly
      created_by: reviewerId,
    });

    // 5. Every mutation carries the reviewer as actor in the audit log.
    const auditRes = await runSql(`
      select count(*)::int as n from public.audit_log
      where tenant_id = '${T.tenantId}' and table_name = 'facts'
        and actor_id = '${reviewerId}';
    `);
    expect(auditRes.ok).toBe(true);
    expect((auditRes.body as { n: number }[])[0]!.n).toBeGreaterThanOrEqual(3);

    // 6. Gates green: the engine over the finalized facts finds nothing.
    const after = await runGatesOverDeal();
    expect(after.issues.filter((i) => i.blocking)).toHaveLength(0);
    expect(after.blockedFactIds.size).toBe(0);

    // 7. M7.7: each review mutation recomputed the spread in-request -
    //    engine-stamped metric rows exist (revenue_total = the corrected Σ).
    const metricsRes = await runSql(`
      select metric, value_cents::text as value_cents, engine_version
      from public.computed_metrics
      where deal_id = '${T.dealId}' and metric = 'revenue_total';
    `);
    expect(metricsRes.ok).toBe(true);
    const metricRows = metricsRes.body as Record<string, unknown>[];
    expect(metricRows).toHaveLength(1);
    expect(metricRows[0]!["value_cents"]).toBe(SALES_CENTS);
    expect(metricRows[0]!["engine_version"]).toMatch(/^engine-v/);
  });
});
