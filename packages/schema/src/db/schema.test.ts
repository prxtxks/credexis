/**
 * Structural assertions over the Drizzle schema (M2.1; groundwork for M2.7's
 * "every new table has RLS" CI check). These run without a database.
 */

import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./index.js";

/** Every pgTable exported from the schema. */
const allTables = Object.values(schema).filter((v): v is PgTable => v instanceof PgTable);

/** Global reference tables — the ONLY tables allowed to lack tenant_id. */
const GLOBAL_TABLES = new Set(["tenants", "taxonomy_nodes", "form_registry", "policy_packs"]);

/** learned_mappings carries a NULLABLE tenant_id (null = global mapping). */
const NULLABLE_TENANT = new Set(["learned_mappings"]);

const configs = allTables.map((t) => getTableConfig(t));

describe("schema completeness (Blueprint §5)", () => {
  it("defines every table the blueprint names", () => {
    const names = new Set(configs.map((c) => c.name));
    const required = [
      "tenants",
      "profiles",
      "deals",
      "entities",
      "documents",
      "logical_documents",
      "pages",
      "periods",
      "facts",
      "extraction_runs",
      "addbacks",
      "loan_scenarios",
      "invites",
      "computed_metrics",
      "issues",
      "audit_log",
      "taxonomy_nodes",
      "form_registry",
      "learned_mappings",
      "policy_packs",
      "transcript_consents", // M9.2
    ];
    for (const table of required) {
      expect(names, `missing table ${table}`).toContain(table);
    }
    expect(names.size).toBe(required.length);
  });
});

describe("tenancy (Iron Law #7 groundwork)", () => {
  it("every non-global table has a NOT NULL tenant_id", () => {
    for (const c of configs) {
      if (GLOBAL_TABLES.has(c.name)) continue;
      const tenantCol = c.columns.find((col) => col.name === "tenant_id");
      expect(tenantCol, `${c.name} lacks tenant_id`).toBeDefined();
      if (!NULLABLE_TENANT.has(c.name)) {
        expect(tenantCol!.notNull, `${c.name}.tenant_id must be NOT NULL`).toBe(true);
      }
    }
  });
});

describe("money columns (Iron Law #2)", () => {
  it("every *_cents / *_usd column is bigint — never numeric/float/int", () => {
    for (const c of configs) {
      for (const col of c.columns) {
        if (/(?:_cents|_usd)$/.test(col.name)) {
          expect(
            col.getSQLType(),
            `${c.name}.${col.name} must be bigint, got ${col.getSQLType()}`,
          ).toBe("bigint");
        }
      }
    }
  });

  it("facts.value_cents is required; supersession fields exist (Iron Law #5)", () => {
    const factsCfg = configs.find((c) => c.name === "facts")!;
    const byName = new Map(factsCfg.columns.map((col) => [col.name, col]));
    expect(byName.get("value_cents")?.notNull).toBe(true);
    expect(byName.get("superseded_by")).toBeDefined();
    expect(byName.get("original_value_cents")).toBeDefined();
    // Lineage columns per Iron Law #5.
    for (const lineage of [
      "source_logical_document_id",
      "source_page",
      "source_bbox",
      "method",
      "confidence",
      "status",
    ]) {
      expect(byName.get(lineage), `facts.${lineage} missing`).toBeDefined();
    }
  });

  it("facts key into taxonomy OR registry — registry-only facts allowed (ADR-0002 follow-up)", () => {
    const factsCfg = configs.find((c) => c.name === "facts")!;
    const byName = new Map(factsCfg.columns.map((col) => [col.name, col]));
    // Derived tax lines (AGI, taxable income) carry no taxonomy placement.
    expect(byName.get("taxonomy_node_key")?.notNull).toBe(false);
    expect(byName.get("registry_field_id")?.notNull).toBe(false);
    // …but a fact with NEITHER key is an unaddressable orphan: the CHECK
    // (taxonomy_node_key IS NOT NULL OR registry_field_id IS NOT NULL) must exist.
    const check = factsCfg.checks.find((k) => k.name === "facts_taxonomy_or_registry_check");
    expect(check, "facts_taxonomy_or_registry_check missing").toBeDefined();
  });
});

describe("policy is data (Iron Law #8)", () => {
  it("deals pin a policy pack; policy_packs are versioned", () => {
    const dealsCfg = configs.find((c) => c.name === "deals")!;
    const pin = dealsCfg.columns.find((col) => col.name === "policy_pack_id");
    expect(pin?.notNull).toBe(true);
    const packs = configs.find((c) => c.name === "policy_packs")!;
    expect(packs.columns.some((col) => col.name === "version")).toBe(true);
    expect(packs.columns.some((col) => col.name === "rules")).toBe(true);
  });
});

describe("audit log (bank requirement)", () => {
  it("captures actor, action, before/after", () => {
    const audit = configs.find((c) => c.name === "audit_log")!;
    const names = audit.columns.map((col) => col.name);
    for (const required of ["actor_id", "action", "table_name", "row_id", "before", "after"]) {
      expect(names, `audit_log.${required} missing`).toContain(required);
    }
  });
});
