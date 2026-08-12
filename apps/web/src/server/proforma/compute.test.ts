/**
 * computeDealProforma (M15/M21): the base assembles from accepted facts,
 * and every line DISCLOSES its sources - the payroll-taxes case (Domain
 * Ruling #1) is the fixture: two printed lines, one category, and the
 * underwriter can see both. Arithmetic stays engine-side (Iron Law #3):
 * the client-facing operatingExpensesCents comes from the compute, never
 * from the panel.
 */

import { describe, expect, it } from "vitest";
import { computeDealProforma } from "./compute";

type Rows = { data: unknown; error: null };
const ok = (data: unknown): Rows => ({ data, error: null });

/** Minimal chainable stub for the supabase query builder paths compute uses. */
function fakeSupabase(tables: Record<string, unknown>) {
  return {
    from(table: string) {
      const result = ok(tables[table] ?? []);
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "eq", "in"]) builder[m] = chain;
      builder["maybeSingle"] = () =>
        Promise.resolve(
          Array.isArray(tables[table])
            ? ok((tables[table] as unknown[])[0] ?? null)
            : ok(tables[table] ?? null),
        );
      // Awaiting the builder itself resolves the row list.
      builder["then"] = (resolve: (v: Rows) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  };
}

const DEAL = "00000000-0000-4000-8000-00000000dea1";
const ENTITY = "00000000-0000-4000-8000-0000000e0001";
const LDOC = "00000000-0000-4000-8000-00000000d0c1";

describe("computeDealProforma", () => {
  const tables = {
    entities: [{ id: ENTITY, name: "Hospitality Jeff Management", kind: "target" }],
    facts: [
      // Domain Ruling #1: subsection total + line 571 unemployment - two
      // printed lines, one semantic category.
      {
        taxonomy_node_key: "is.opex.payroll_taxes",
        value_cents: "999794",
        status: "accepted",
        method: "statement_suggested",
        source_page: 1,
        registry_field_id: null,
        source_logical_document_id: LDOC,
        periods: { label: "FY2024" },
      },
      {
        taxonomy_node_key: "is.opex.payroll_taxes",
        value_cents: "71280",
        status: "accepted",
        method: "human",
        source_page: 1,
        registry_field_id: null,
        source_logical_document_id: LDOC,
        periods: { label: "FY2024" },
      },
      {
        taxonomy_node_key: "is.revenue.total",
        value_cents: "71809233",
        status: "accepted",
        method: "statement_suggested",
        source_page: 1,
        registry_field_id: null,
        source_logical_document_id: LDOC,
        periods: { label: "FY2024" },
      },
    ],
    proforma_assumptions: [],
    logical_documents: [{ id: LDOC, form_family: "PNL", tax_year: 2024 }],
  };

  it("sums semantic-category facts and discloses each source line", async () => {
    const r = await computeDealProforma(fakeSupabase(tables), {
      dealId: DEAL,
      scenarioId: null,
    });
    if (r.state !== "ready") throw new Error(`expected ready, got ${r.state}`);

    const payroll = r.base.lines.find((l) => l.key === "is.opex.payroll_taxes");
    expect(payroll).toBeDefined();
    expect(payroll!.amountCents).toBe(1071074n);

    const sources = (payroll as unknown as { sources: { valueCents: bigint }[] }).sources;
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.valueCents).sort()).toEqual([71280n, 999794n]);
    const first = sources[0] as unknown as {
      docLabel: string | null;
      page: number | null;
      method: string;
    };
    expect(first.docLabel).toBe("PNL 2024");
    expect(first.page).toBe(1);
  });

  it("serves the base opex total from the engine - the client never adds", async () => {
    const r = await computeDealProforma(fakeSupabase(tables), {
      dealId: DEAL,
      scenarioId: null,
    });
    if (r.state !== "ready") throw new Error(`expected ready, got ${r.state}`);
    // 12-month base: annualized === base; single expense line → total = it.
    expect(r.projection.baseAnnualized.operatingExpensesCents).toBe(1071074n);
  });

  it("excluded lines leave the engine-computed base total", async () => {
    const r = await computeDealProforma(fakeSupabase(tables), {
      dealId: DEAL,
      scenarioId: null,
      preview: { lineTreatments: { "is.opex.payroll_taxes": "excluded" } },
    });
    if (r.state !== "ready") throw new Error(`expected ready, got ${r.state}`);
    expect(r.projection.baseAnnualized.operatingExpensesCents).toBe(0n);
    expect(r.projection.baseAnnualized.lines).toHaveLength(0);
  });
});
