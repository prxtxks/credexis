/**
 * M5.5 tests + the M5 EXIT GATE: "messy QuickBooks P&L + CPA balance sheet
 * flow to mapped facts with issues raised where structure breaks."
 * Full chain: grid → row typing → period binding → taxonomy mapping →
 * structure validation. Synthetic, clearly labeled (Iron Law #9).
 */

import { describe, expect, it } from "vitest";
import type { StatementGrid } from "./grid.js";
import { typeRows } from "./row-typing.js";
import { bindPeriods } from "./period-binding.js";
import { InMemoryMappingsStore, mapLabels } from "./taxonomy-mapper.js";
import { validateStructure } from "./structure-validation.js";

function grid(rows: Array<[string, ...(string | null)[]]>): StatementGrid {
  const columnCount = Math.max(...rows.map((r) => r.length - 1));
  return {
    page: 1,
    bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    columnIds: Array.from({ length: columnCount }, (_, i) => i + 1),
    rows: rows.map(([label, ...values], i) => ({
      rowIndex: i,
      label,
      labelX: 0.05,
      cells: new Map(
        values
          .map((v, ci) => [ci + 1, v] as const)
          .filter((e): e is [number, string] => e[1] !== null)
          .map(([col, text]) => [
            col,
            { text, bbox: { x: 0.2 + col * 0.2, y: 0.05 + i * 0.03, w: 0.15, h: 0.02 } },
          ]),
      ),
    })),
  };
}

const GLOBAL_MAPPINGS: Record<string, string> = {
  sales: "is.revenue.product_sales",
  services: "is.revenue.service_revenue",
  "total income": "is.revenue.total",
  rent: "is.opex.rent",
  payroll: "is.opex.salaries_wages",
  "total expenses": "is.opex.total",
  "net income": "is.net_income",
  cash: "bs.assets.current.cash",
  receivables: "bs.assets.current.accounts_receivable",
  "total assets": "bs.assets.total",
  "accounts payable": "bs.liabilities.current.accounts_payable",
  "total liabilities": "bs.liabilities.total",
  "retained earnings": "bs.equity.retained_earnings",
  "total equity": "bs.equity.total",
  "total liabilities and equity": "bs.total_liabilities_equity",
};

async function preloadedStore(): Promise<InMemoryMappingsStore> {
  const store = new InMemoryMappingsStore();
  for (const [labelNorm, node] of Object.entries(GLOBAL_MAPPINGS)) {
    await store.upsert(null, {
      labelNorm,
      taxonomyNodeKey: node,
      confidence: 0.95,
      source: "human",
      usageCount: 10,
    });
  }
  return store;
}

async function runChain(g: StatementGrid, statement: "PNL" | "BALANCE_SHEET") {
  const typed = typeRows(g);
  const binding = bindPeriods(g);
  const labels = g.rows.map((r) => r.label).filter((l) => l !== "");
  const mapped = await mapLabels(labels, statement, "t1", await preloadedStore(), null);
  const mappedByLabel = new Map(mapped.map((m) => [m.label, m]));
  return validateStructure(typed, binding, mappedByLabel, { statement, page: g.page });
}

describe("M5 EXIT GATE — messy QuickBooks P&L (in thousands, planted break)", () => {
  // FY2023 'Total Income' is printed 545,000 but its items sum to 540,000.
  const pnl = grid([
    ["", "FY2024", "FY2023"],
    ["ACME HOLDINGS LLC (in thousands)"],
    ["Income"],
    ["Sales", "500,000", "450,000"],
    ["Services", "100,000", "90,000"],
    ["Total Income", "600,000", "545,000"], // ← FY2023 break (+5,000)
    ["Expenses"],
    ["Rent", "36,000", "34,000"],
    ["Payroll", "300,000", "280,000"],
    ["Total Expenses", "336,000", "314,000"],
    ["Net Income", "264,000", "226,000"],
    ["Zorble Fees", "1,000", "900"], // unmappable → review
  ]);

  it("produces mapped, period-bound, unit-scaled facts", async () => {
    const result = await runChain(pnl, "PNL");
    const sales24 = result.facts.find(
      (f) => f.taxonomyNodeKey === "is.revenue.product_sales" && f.periodLabel === "FY2024",
    );
    // 500,000 (printed) × 1000 (in thousands) = $500,000,000.00
    expect(sales24?.valueCents).toBe(50_000_000_000n);
    const rent23 = result.facts.find(
      (f) => f.taxonomyNodeKey === "is.opex.rent" && f.periodLabel === "FY2023",
    );
    expect(rent23?.valueCents).toBe(3_400_000_000n);
    expect(result.facts.every((f) => f.mappingMethod === "exact_global")).toBe(true);
  });

  it("raises G1 issues exactly where the structure breaks (FY2023 only)", async () => {
    const result = await runChain(pnl, "PNL");
    const g1 = result.issues.filter((i) => i.gate === "G1");
    expect(g1.length).toBeGreaterThanOrEqual(1);
    expect(g1.every((i) => i.periodLabel === "FY2023")).toBe(true); // FY2024 is clean
    const subtotalIssue = g1.find((i) => i.rowLabel === "Total Income");
    expect(subtotalIssue?.deltaCents).toBe(500_000n); // $5,000 in raw cents
  });

  it("routes unmappable labels to review, never inventing a node", async () => {
    const result = await runChain(pnl, "PNL");
    expect(result.unmappedLabels).toEqual(["Zorble Fees"]);
    expect(result.facts.some((f) => f.sourceLabel === "Zorble Fees")).toBe(false);
  });
});

describe("M5 EXIT GATE — CPA balance sheet (planted A ≠ L + E)", () => {
  const bs = grid([
    ["", "December 31, 2024"],
    ["Assets"],
    ["Cash", "50,000"],
    ["Receivables", "30,000"],
    ["Total Assets", "80,000"],
    ["Liabilities"],
    ["Accounts Payable", "20,000"],
    ["Total Liabilities", "20,000"],
    ["Equity"],
    ["Retained Earnings", "61,000"],
    ["Total Equity", "61,000"],
    ["Total Liabilities and Equity", "81,000"], // ← A=80,000 vs L+E=81,000
  ]);

  it("binds the as-of column and raises the G2 identity violation", async () => {
    const result = await runChain(bs, "BALANCE_SHEET");
    const g2 = result.issues.filter((i) => i.gate === "G2");
    expect(g2).toHaveLength(1);
    expect(g2[0]).toMatchObject({
      periodLabel: "As of 2024-12-31",
      deltaCents: 100_000n, // $1,000 imbalance
    });
  });

  it("a balanced sheet raises no G2 issue (±$2 tolerance honored)", async () => {
    const balanced = grid([
      ["", "December 31, 2024"],
      ["Assets"],
      ["Cash", "50,000.75"],
      ["Total Assets", "50,000.75"],
      ["Liabilities"],
      ["Accounts Payable", "20,000"],
      ["Total Liabilities", "20,000"],
      ["Equity"],
      ["Retained Earnings", "30,001.50"], // off by 75¢ — inside ±$2
      ["Total Equity", "30,001.50"],
      ["Total Liabilities and Equity", "50,001.50"],
    ]);
    const result = await runChain(balanced, "BALANCE_SHEET");
    expect(result.issues.filter((i) => i.gate === "G2")).toHaveLength(0);
  });
});

describe("total rows emit facts (bake-off finding, 2026-07-20)", () => {
  it("a mapped, bound subtotal/total row becomes a fact draft", async () => {
    const g = grid([
      ["", "FY2024"],
      ["Rent", "12,000.00"],
      ["Total Expenses", "12,000.00"],
    ]);
    const store = await preloadedStore();
    await store.upsert(null, {
      labelNorm: "total expenses",
      taxonomyNodeKey: "is.opex.total",
      confidence: 0.95,
      source: "human",
      usageCount: 5,
    });
    const typed = typeRows(g);
    const labels = g.rows.map((r) => r.label).filter((l) => l !== "");
    const mapped = await mapLabels(labels, "PNL", "t1", store, null);
    const result = validateStructure(
      typed,
      bindPeriods(g),
      new Map(mapped.map((m) => [m.label, m])),
      { statement: "PNL", page: g.page },
    );
    const totalFact = result.facts.find((f) => f.taxonomyNodeKey === "is.opex.total");
    expect(totalFact).toBeDefined();
    expect(totalFact!.valueCents).toBe(1200000n);
    expect(totalFact!.sourceLabel).toBe("Total Expenses");
  });
});
