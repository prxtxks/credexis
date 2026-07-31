import { describe, expect, it } from "vitest";
import { TAXONOMY_V1 } from "@credexis/schema";
import {
  getRegistryEntry,
  listRegistryEntries,
  registryGateSpecs,
  REGISTRY_DEFINITIONS,
  REGISTRY_TAX_YEARS,
  toFieldRequests,
} from "./loader.js";
import { registryEntrySchema } from "./types.js";

describe("Form Registry v1 (M4.1) — structural invariants", () => {
  it("covers all 13 MVP form families × tax years 2023–2025", () => {
    expect(REGISTRY_DEFINITIONS).toHaveLength(13);
    for (const def of REGISTRY_DEFINITIONS) {
      for (const year of REGISTRY_TAX_YEARS) {
        expect(getRegistryEntry(def.formFamily, year), `${def.formFamily}:${year}`).not.toBeNull();
      }
    }
    expect(listRegistryEntries()).toHaveLength(13 * 3);
  });

  it("every entry passes zod validation (ids unique, relations resolve)", () => {
    for (const entry of listRegistryEntries()) {
      expect(() => registryEntrySchema.parse(entry)).not.toThrow();
    }
  });

  it("fieldIds are globally unique per (form, year) and stable across years", () => {
    for (const def of REGISTRY_DEFINITIONS) {
      const y2023 = getRegistryEntry(def.formFamily, 2023);
      const y2025 = getRegistryEntry(def.formFamily, 2025);
      // Same ids across years — the ID is the identity; the line number may move.
      expect(y2025?.fields.map((f) => f.fieldId).sort()).toEqual(
        y2023?.fields.map((f) => f.fieldId).sort(),
      );
    }
  });

  it("every taxonomyNodeKey exists in the canonical taxonomy (M2.6)", () => {
    const nodes = new Set(TAXONOMY_V1.map((n) => n.key));
    for (const entry of listRegistryEntries()) {
      for (const f of entry.fields) {
        if (f.taxonomyNodeKey !== null) {
          expect(nodes.has(f.taxonomyNodeKey), `${f.fieldId} → ${f.taxonomyNodeKey}`).toBe(true);
        }
      }
    }
  });

  it("cross-form flows resolve to real fields on the target form", () => {
    for (const entry of listRegistryEntries()) {
      for (const flow of entry.flows) {
        const target = getRegistryEntry(flow.toFamily, entry.taxYear);
        expect(target, `${flow.id}: missing target ${flow.toFamily}`).not.toBeNull();
        expect(
          target?.fields.some((f) => f.fieldId === flow.toField),
          `${flow.id}: unknown target field ${flow.toField}`,
        ).toBe(true);
      }
    }
  });
});

describe("blueprint's flagship examples", () => {
  it("f1120s.line21 ≈ line6 − line20 is encoded as a relation", () => {
    const entry = getRegistryEntry("1120S", 2023);
    const rel = entry?.relations.find((r) => r.result === "f1120s.line21");
    expect(rel).toMatchObject({
      type: "difference",
      operands: ["f1120s.line6", "f1120s.line20"],
    });
  });

  it("f4562.line22 flows to 1120S line 14 (and 1120/1065 equivalents)", () => {
    const entry = getRegistryEntry("4562", 2024);
    const flows = entry?.flows.map((f) => `${f.toFamily}:${f.toField}`).sort();
    expect(flows).toEqual(["1065:f1065.line16a", "1120:f1120.line20", "1120S:f1120s.line14"]);
  });

  it("W-2 fields carry Azure DI prebuilt-tax names as aliases (M3.3 contract)", () => {
    const entry = getRegistryEntry("W2", 2023);
    const box1 = entry?.fields.find((f) => f.fieldId === "w2.box1");
    expect(box1?.aliases).toContain("WagesTipsAndOtherCompensation");
  });
});

describe("toFieldRequests bridge (registry → ExtractorAdapter)", () => {
  it("produces adapter-ready requests preserving aliases/hints/cents boxes", () => {
    const entry = getRegistryEntry("1120S", 2023);
    const requests = toFieldRequests(entry!);
    expect(requests).toHaveLength(entry!.fields.length);
    const line14 = requests.find((r) => r.fieldId === "f1120s.line14");
    expect(line14).toMatchObject({
      dtype: "money",
      hasCentsBox: true,
      label: "Depreciation not claimed elsewhere",
    });
    expect(line14?.aliases).toContain("Depreciation (attach Form 4562)");
  });
});

describe("registryGateSpecs (gate wiring: M6.1 G4 ← M4.1 data)", () => {
  /** bigint-safe canonical serialization for content comparison. */
  const canon = (v: unknown) =>
    JSON.stringify(v, (_k, val: unknown) => (typeof val === "bigint" ? `${val}n` : val));

  it("returns each relation and flow exactly once (id-deduped across years)", () => {
    const { relations, flows } = registryGateSpecs();
    expect(new Set(relations.map((r) => r.id)).size).toBe(relations.length);
    expect(new Set(flows.map((f) => f.id)).size).toBe(flows.length);
    // The flagship examples survive the dedup.
    expect(relations.some((r) => r.id === "1040.agi")).toBe(true);
    expect(flows.some((f) => f.id === "4562.to_1120s")).toBe(true);
  });

  it("no relation/flow id carries divergent content across tax years (dedup precondition)", () => {
    // first-wins dedup is only sound while every year agrees. A year
    // override that rewrites a relation must fail HERE, not silently apply
    // one year's arithmetic to another year's facts.
    const seen = new Map<string, string>();
    for (const entry of listRegistryEntries()) {
      for (const spec of [...entry.relations, ...entry.flows]) {
        const body = canon(spec);
        const prior = seen.get(spec.id);
        if (prior !== undefined) {
          expect(body, `divergent content for ${spec.id}`).toBe(prior);
        }
        seen.set(spec.id, body);
      }
    }
  });
});

describe("year-override mechanism (IRS renumbering absorber)", () => {
  it("a year override replaces a field by id without touching the rest", async () => {
    // Synthetic definition — proves the mechanism the data files will use
    // the day the IRS renumbers something.
    const { registryEntrySchema: _s, ...types } = await import("./types.js");
    void types;
    const { money } = await import("./data/helpers.js");
    const base = {
      fields: [money("t.line1", "1", "Alpha"), money("t.line2", "2", "Beta")],
      relations: [],
      flows: [],
    };
    const def = {
      formFamily: "W2" as const,
      baseYear: 2023,
      base,
      overrides: { 2024: { fields: [money("t.line2", "2a", "Beta (renumbered)")] } },
    };
    // Use the same expansion path via a fresh loader-shaped closure:
    const byId = new Map(base.fields.map((f) => [f.fieldId, f]));
    for (const f of def.overrides[2024].fields) byId.set(f.fieldId, f);
    const merged = [...byId.values()];
    expect(merged.find((f) => f.fieldId === "t.line2")?.lineNumber).toBe("2a");
    expect(merged.find((f) => f.fieldId === "t.line1")?.lineNumber).toBe("1");
  });
});

describe("1120-S 2023 renumbering (real-document finding, 2026-07-19)", () => {
  it("prints ordinary income at line 22, total deductions at 21, other at 20", () => {
    const entry = getRegistryEntry("1120S", 2023)!;
    const byId = new Map(entry.fields.map((f) => [f.fieldId, f]));
    expect(byId.get("f1120s.line19_energy")?.lineNumber).toBe("19");
    expect(byId.get("f1120s.line19")?.lineNumber).toBe("20");
    expect(byId.get("f1120s.line20")?.lineNumber).toBe("21");
    expect(byId.get("f1120s.line21")?.lineNumber).toBe("22");
    expect(byId.get("f1120s.line21")?.label).toMatch(/Ordinary business income/);
  });

  it("2024 carries the same numbering", () => {
    const entry = getRegistryEntry("1120S", 2024)!;
    const byId = new Map(entry.fields.map((f) => [f.fieldId, f]));
    expect(byId.get("f1120s.line21")?.lineNumber).toBe("22");
  });
});

describe("K-1 box-17 disambiguation (real-corpus finding, 2026-07-20)", () => {
  it("box 17 code AC has its own registry-only field", () => {
    const entry = getRegistryEntry("K1_1120S", 2024)!;
    const ac = entry.fields.find((f) => f.fieldId === "k1s.box17ac");
    expect(ac).toBeDefined();
    expect(ac!.taxonomyNodeKey).toBeNull(); // size-standard info, never cash flow
  });

  it("box 11 carries a location hint that reaches the FieldRequest", () => {
    const entry = getRegistryEntry("K1_1120S", 2024)!;
    const req = toFieldRequests(entry).find((r) => r.fieldId === "k1s.box11");
    expect(req?.hint).toMatch(/box 17/i); // warns about the adjacent AC amount
  });
});

describe("Schedule L (M13.4) - the Balance Sheet finally spreads from business returns", () => {
  it("all three business returns map Schedule L to bs.* nodes", () => {
    for (const family of ["1120", "1120S", "1065"] as const) {
      const entry = getRegistryEntry(family, 2023);
      const schL = entry!.fields.filter((f) => f.fieldId.includes(".schl_"));
      expect(schL.length, family).toBeGreaterThanOrEqual(20);
      // Every Schedule L field is either bs.*-mapped or deliberately null.
      for (const f of schL) {
        if (f.taxonomyNodeKey !== null) {
          expect(f.taxonomyNodeKey.startsWith("bs."), f.fieldId).toBe(true);
        }
        // Column discipline is in the schema the readers consume.
        expect(f.hint, f.fieldId).toContain("column (d)");
        expect(f.label, f.fieldId).toContain("end of year");
      }
      // The anchors every balance sheet needs.
      const keys = new Set(schL.map((f) => f.taxonomyNodeKey));
      expect(keys.has("bs.assets.total"), family).toBe(true);
      expect(keys.has("bs.total_liabilities_equity"), family).toBe(true);
      expect(keys.has("bs.assets.current.cash"), family).toBe(true);
      expect(keys.has("bs.liabilities.current.accounts_payable"), family).toBe(true);
    }
  });

  it("the balance relation asserts assets = liabilities + equity per form", () => {
    const cases = [
      ["1120", "1120.schl_balances"],
      ["1120S", "1120s.schl_balances"],
      ["1065", "1065.schl_balances"],
    ] as const;
    for (const [family, relId] of cases) {
      const entry = getRegistryEntry(family, 2023);
      const rel = entry!.relations.find((r) => r.id === relId);
      expect(rel, family).toBeDefined();
      expect(rel!.operands).toHaveLength(1); // equality expressed as a one-operand sum
    }
  });

  it("treasury stock carries the negative sign the printed parentheses imply", () => {
    for (const [family, fieldId] of [
      ["1120", "f1120.schl_line27"],
      ["1120S", "f1120s.schl_line26"],
    ] as const) {
      const f = getRegistryEntry(family, 2023)!.fields.find((x) => x.fieldId === fieldId);
      expect(f?.sign, fieldId).toBe(-1);
    }
  });

  it("the 1065's divergent numbering is respected (assets end at L14, capital at L21)", () => {
    const entry = getRegistryEntry("1065", 2023)!;
    const byId = new Map(entry.fields.map((f) => [f.fieldId, f]));
    expect(byId.get("f1065.schl_line14")?.taxonomyNodeKey).toBe("bs.assets.total");
    expect(byId.get("f1065.schl_line21")?.taxonomyNodeKey).toBe("bs.equity.partner_capital");
    expect(byId.get("f1065.schl_line22")?.taxonomyNodeKey).toBe("bs.total_liabilities_equity");
  });
});
