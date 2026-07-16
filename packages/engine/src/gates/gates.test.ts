import { describe, expect, it } from "vitest";
import { runGates, runG1, runG2, runG3, runG4, runG5, runG6 } from "./gates.js";
import { DEFAULT_GATE_CONFIG, type GateConfig, type GateFact } from "./types.js";

let seq = 0;
function fact(p: Partial<GateFact> & Pick<GateFact, "valueCents">): GateFact {
  seq += 1;
  return {
    id: p.id ?? `f${seq}`,
    entityId: p.entityId ?? "e1",
    periodLabel: p.periodLabel ?? "FY2023",
    taxonomyNodeKey: p.taxonomyNodeKey ?? null,
    registryFieldId: p.registryFieldId ?? null,
    valueCents: p.valueCents,
    method: p.method ?? "consensus",
    status: p.status ?? "suggested",
    logicalDocumentId: p.logicalDocumentId ?? null,
  };
}

const TAXONOMY = [
  { key: "is.opex", parentKey: null },
  { key: "is.opex.rent", parentKey: "is.opex" },
  { key: "is.opex.salaries_wages", parentKey: "is.opex" },
  { key: "is.opex.total", parentKey: "is.opex" },
  { key: "bs.assets.total", parentKey: null },
  { key: "bs.liabilities.total", parentKey: null },
  { key: "bs.equity.total", parentKey: null },
  { key: "bs.total_liabilities_equity", parentKey: null },
  { key: "is.net_income", parentKey: null },
];

const config = (over: Partial<GateConfig> = {}): GateConfig => ({
  taxonomy: TAXONOMY,
  registryRelations: [],
  registryFlows: [],
  ...DEFAULT_GATE_CONFIG,
  ...over,
});

describe("G1 — taxonomy subtotal arithmetic (±$1)", () => {
  it("passes when the .total equals the sum of its siblings", () => {
    const issues = runG1(
      [
        fact({ taxonomyNodeKey: "is.opex.rent", valueCents: 36_000_00n }),
        fact({ taxonomyNodeKey: "is.opex.salaries_wages", valueCents: 300_000_00n }),
        fact({ taxonomyNodeKey: "is.opex.total", valueCents: 336_000_00n }),
      ],
      TAXONOMY,
    );
    expect(issues).toHaveLength(0);
  });

  it("flags a subtotal that does not tie, with the delta and implicated facts", () => {
    const issues = runG1(
      [
        fact({ id: "rent", taxonomyNodeKey: "is.opex.rent", valueCents: 36_000_00n }),
        fact({ id: "sal", taxonomyNodeKey: "is.opex.salaries_wages", valueCents: 300_000_00n }),
        fact({ id: "tot", taxonomyNodeKey: "is.opex.total", valueCents: 340_000_00n }),
      ],
      TAXONOMY,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ gate: "G1", blocking: true, deltaCents: 4_000_00n });
    expect(issues[0]?.implicatedFactIds).toEqual(expect.arrayContaining(["tot", "rent", "sal"]));
  });

  it("honors the ±$1 tolerance", () => {
    const issues = runG1(
      [
        fact({ taxonomyNodeKey: "is.opex.rent", valueCents: 36_000_40n }),
        fact({ taxonomyNodeKey: "is.opex.salaries_wages", valueCents: 300_000_35n }),
        fact({ taxonomyNodeKey: "is.opex.total", valueCents: 336_000_74n }), // 1¢ off
      ],
      TAXONOMY,
    );
    expect(issues).toHaveLength(0);
  });

  it("an override supersedes consensus for the same node (latest-wins)", () => {
    const issues = runG1(
      [
        fact({ taxonomyNodeKey: "is.opex.rent", valueCents: 36_000_00n }),
        fact({ taxonomyNodeKey: "is.opex.salaries_wages", valueCents: 300_000_00n }),
        fact({ taxonomyNodeKey: "is.opex.total", valueCents: 999_999_00n, method: "consensus" }),
        fact({ taxonomyNodeKey: "is.opex.total", valueCents: 336_000_00n, method: "override" }),
      ],
      TAXONOMY,
    );
    expect(issues).toHaveLength(0); // the override value ties, so no issue
  });
});

describe("G2 — balance identity A = L + E (±$2)", () => {
  it("passes with a combined 'total liabilities and equity' line", () => {
    const issues = runG2([
      fact({ taxonomyNodeKey: "bs.assets.total", valueCents: 80_000_00n }),
      fact({ taxonomyNodeKey: "bs.total_liabilities_equity", valueCents: 80_000_00n }),
    ]);
    expect(issues).toHaveLength(0);
  });

  it("computes L+E when there is no combined line, and flags an imbalance", () => {
    const issues = runG2([
      fact({ taxonomyNodeKey: "bs.assets.total", valueCents: 80_000_00n }),
      fact({ taxonomyNodeKey: "bs.liabilities.total", valueCents: 20_000_00n }),
      fact({ taxonomyNodeKey: "bs.equity.total", valueCents: 61_000_00n }), // 81k ≠ 80k
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ gate: "G2", blocking: true, deltaCents: 1_000_00n });
  });
});

describe("G3 — cross-document net-income tie-out", () => {
  it("flags NI that diverges across documents beyond max($500, 1%)", () => {
    const issues = runG3(
      [
        fact({
          taxonomyNodeKey: "is.net_income",
          valueCents: 200_000_00n,
          logicalDocumentId: "d1",
        }),
        fact({
          taxonomyNodeKey: "is.net_income",
          valueCents: 190_000_00n,
          logicalDocumentId: "d2",
        }),
      ],
      config(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ gate: "G3", blocking: true });
  });

  it("passes within the tolerance band (small absolute diff under $500 floor)", () => {
    const issues = runG3(
      [
        fact({
          taxonomyNodeKey: "is.net_income",
          valueCents: 200_000_00n,
          logicalDocumentId: "d1",
        }),
        fact({
          taxonomyNodeKey: "is.net_income",
          valueCents: 200_003_00n,
          logicalDocumentId: "d2",
        }),
      ],
      config(),
    );
    expect(issues).toHaveLength(0);
  });

  it("does not fire on a single document's net income", () => {
    const issues = runG3(
      [
        fact({
          taxonomyNodeKey: "is.net_income",
          valueCents: 200_000_00n,
          logicalDocumentId: "d1",
        }),
      ],
      config(),
    );
    expect(issues).toHaveLength(0);
  });
});

describe("G4 — registry relations + cross-form flows", () => {
  const cfg = config({
    registryRelations: [
      {
        id: "1120s.total_deductions",
        type: "sum",
        result: "f1120s.line20",
        operands: ["f1120s.line7", "f1120s.line11"],
        toleranceCents: 100n,
        description: "20 = 7 + 11",
      },
    ],
    registryFlows: [
      {
        id: "4562.to.1120s",
        fromField: "f4562.line22",
        toField: "f1120s.line14",
        toleranceCents: 0n,
        description: "4562 line 22 → 1120-S line 14",
      },
    ],
  });

  it("passes a satisfied sum relation", () => {
    const issues = runG4(
      [
        fact({ registryFieldId: "f1120s.line7", valueCents: 185_000_00n }),
        fact({ registryFieldId: "f1120s.line11", valueCents: 36_000_00n }),
        fact({ registryFieldId: "f1120s.line20", valueCents: 221_000_00n }),
      ],
      cfg,
    );
    expect(issues).toHaveLength(0);
  });

  it("flags a broken relation with its description", () => {
    const issues = runG4(
      [
        fact({ registryFieldId: "f1120s.line7", valueCents: 185_000_00n }),
        fact({ registryFieldId: "f1120s.line11", valueCents: 36_000_00n }),
        fact({ registryFieldId: "f1120s.line20", valueCents: 225_000_00n }),
      ],
      cfg,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("20 = 7 + 11");
  });

  it("flags a cross-form flow mismatch (exact tolerance)", () => {
    const issues = runG4(
      [
        fact({ registryFieldId: "f4562.line22", valueCents: 42_000_00n }),
        fact({ registryFieldId: "f1120s.line14", valueCents: 41_999_00n }),
      ],
      cfg,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ gate: "G4", deltaCents: 1_00n });
  });

  it("does not fire when the extraction is partial (missing an operand)", () => {
    const issues = runG4(
      [fact({ registryFieldId: "f1120s.line20", valueCents: 221_000_00n })],
      cfg,
    );
    expect(issues).toHaveLength(0);
  });
});

describe("G5 — transcript match (fraud signal)", () => {
  it("flags a parsed value that contradicts the IRS transcript as critical + blocking", () => {
    const issues = runG5([
      fact({ registryFieldId: "f1040.line11", valueCents: 95_000_00n, method: "vendor" }),
      fact({ registryFieldId: "f1040.line11", valueCents: 120_000_00n, method: "transcript" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ gate: "G5", severity: "critical", blocking: true });
    expect(issues[0]?.message).toMatch(/tampering/i);
  });

  it("passes when parsed equals transcript", () => {
    const issues = runG5([
      fact({ registryFieldId: "f1040.line11", valueCents: 120_000_00n, method: "vendor" }),
      fact({ registryFieldId: "f1040.line11", valueCents: 120_000_00n, method: "transcript" }),
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("G6 — temporal sanity (flag only, never blocking)", () => {
  it("flags a YoY swing beyond the band but does NOT block", () => {
    const issues = runG6(
      [
        fact({ taxonomyNodeKey: "is.net_income", periodLabel: "FY2022", valueCents: 100_000_00n }),
        fact({ taxonomyNodeKey: "is.net_income", periodLabel: "FY2023", valueCents: 500_000_00n }),
      ],
      config(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ gate: "G6", severity: "warning", blocking: false });
  });

  it("stays quiet on a modest YoY change", () => {
    const issues = runG6(
      [
        fact({ taxonomyNodeKey: "is.net_income", periodLabel: "FY2022", valueCents: 100_000_00n }),
        fact({ taxonomyNodeKey: "is.net_income", periodLabel: "FY2023", valueCents: 110_000_00n }),
      ],
      config(),
    );
    expect(issues).toHaveLength(0);
  });

  it("does not compare non-consecutive years", () => {
    const issues = runG6(
      [
        fact({ taxonomyNodeKey: "is.net_income", periodLabel: "FY2021", valueCents: 100_000_00n }),
        fact({ taxonomyNodeKey: "is.net_income", periodLabel: "FY2023", valueCents: 500_000_00n }),
      ],
      config(),
    );
    expect(issues).toHaveLength(0);
  });
});

describe("runGates — aggregation + blocking semantics (Iron Law #6)", () => {
  it("collects issues from every gate and blocks only G1–G5 implicated facts", () => {
    const { issues, blockedFactIds } = runGates(
      [
        // G1 break
        fact({ id: "rent", taxonomyNodeKey: "is.opex.rent", valueCents: 36_000_00n }),
        fact({ id: "sal", taxonomyNodeKey: "is.opex.salaries_wages", valueCents: 300_000_00n }),
        fact({ id: "opextot", taxonomyNodeKey: "is.opex.total", valueCents: 340_000_00n }),
        // G6-only swing (net income across two years) — must NOT be blocked
        fact({
          id: "ni22",
          taxonomyNodeKey: "is.net_income",
          periodLabel: "FY2022",
          valueCents: 100_000_00n,
        }),
        fact({
          id: "ni23",
          taxonomyNodeKey: "is.net_income",
          periodLabel: "FY2023",
          valueCents: 500_000_00n,
        }),
      ],
      config(),
    );
    expect(issues.some((i) => i.gate === "G1")).toBe(true);
    expect(issues.some((i) => i.gate === "G6")).toBe(true);
    // G1 facts blocked…
    expect(blockedFactIds.has("opextot")).toBe(true);
    expect(blockedFactIds.has("rent")).toBe(true);
    // …G6-only facts are NOT (flag-only gate).
    expect(blockedFactIds.has("ni22")).toBe(false);
    expect(blockedFactIds.has("ni23")).toBe(false);
  });

  it("ignores rejected facts entirely", () => {
    const { issues } = runGates(
      [
        fact({ taxonomyNodeKey: "is.opex.rent", valueCents: 36_000_00n, status: "rejected" }),
        fact({
          taxonomyNodeKey: "is.opex.salaries_wages",
          valueCents: 300_000_00n,
          status: "rejected",
        }),
        fact({ taxonomyNodeKey: "is.opex.total", valueCents: 999_999_00n, status: "rejected" }),
      ],
      config(),
    );
    expect(issues).toHaveLength(0);
  });
});
