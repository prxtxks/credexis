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
  it("covers all 13 MVP form families × 2023-2025, business returns back to 2020", () => {
    expect(REGISTRY_DEFINITIONS).toHaveLength(13);
    for (const def of REGISTRY_DEFINITIONS) {
      for (const year of REGISTRY_TAX_YEARS) {
        expect(getRegistryEntry(def.formFamily, year), `${def.formFamily}:${year}`).not.toBeNull();
      }
    }
    // M14.4: real deals carry returns back to 2020 - the business families
    // add three back-years each (Golden Deal 1: 2020-2022 filings).
    for (const family of ["1120S", "1120", "1065"] as const) {
      for (const year of [2020, 2021, 2022]) {
        expect(getRegistryEntry(family, year), `${family}:${year}`).not.toBeNull();
      }
    }
    expect(listRegistryEntries()).toHaveLength(13 * 3 + 9);
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
  it("dedups by content and annotates each variant with its tax years", () => {
    const { relations, flows } = registryGateSpecs();
    // The flagship examples survive.
    expect(relations.some((r) => r.id === "1040.agi")).toBe(true);
    expect(flows.some((f) => f.id === "4562.to_1120s")).toBe(true);
    // Every spec carries at least one year.
    for (const s of [...relations, ...flows]) {
      expect(s.taxYears.length, s.id).toBeGreaterThan(0);
    }
  });

  it("an id with divergent content across years yields disjoint year-scoped variants", () => {
    // The §179D renumbering (M14.4): total-deductions sums DIFFERENT
    // operand sets pre/post 2023. Both variants must exist, each scoped to
    // exactly its years - the engine picks by the period's FY label, and
    // the year sets must never overlap (overlap = two arithmetics claiming
    // the same period).
    const { relations } = registryGateSpecs();
    const variants = relations.filter((r) => r.id === "1120s.total_deductions");
    expect(variants).toHaveLength(2);
    const pre = variants.find((v) => !v.operands.includes("f1120s.line19_energy"))!;
    const post = variants.find((v) => v.operands.includes("f1120s.line19_energy"))!;
    expect(pre.taxYears).toEqual([2020, 2021, 2022]);
    expect(post.taxYears).toEqual([2023, 2024, 2025]);
    // Disjointness holds for EVERY multi-variant id.
    const byId = new Map<string, number[][]>();
    for (const r of relations) {
      byId.set(r.id, [...(byId.get(r.id) ?? []), r.taxYears]);
    }
    for (const [id, sets] of byId) {
      const all = sets.flat();
      expect(new Set(all).size, `overlapping year scopes for ${id}`).toBe(all.length);
    }
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

describe("back-years 2020-2022 (M14.4, Golden Deal 1: real returns predate 2023)", () => {
  // Verified against the printed forms in corpus/signal-sweep: the 2023
  // revisions inserted the §179D energy deduction (1120-S line 19, 1065
  // line 20) and shifted everything below by one. 2019/2021 revisions
  // (serving TY 2020-2022) share ONE stable pre-§179D numbering.
  it("1065 2022 resolves with pre-§179D numbering", () => {
    const e = getRegistryEntry("1065", 2022);
    expect(e).not.toBeNull();
    const by = new Map(e!.fields.map((f) => [f.fieldId, f.lineNumber]));
    expect(by.get("f1065.line20")).toBe("20"); // Other deductions
    expect(by.get("f1065.line21")).toBe("21"); // Total deductions
    expect(by.get("f1065.line22")).toBe("22"); // Ordinary business income
    expect(by.has("f1065.line20_energy")).toBe(false);
  });

  it("1065 2023 carries the printed 2023 numbering (base was wrong)", () => {
    const e = getRegistryEntry("1065", 2023)!;
    const by = new Map(e.fields.map((f) => [f.fieldId, f.lineNumber]));
    expect(by.get("f1065.line20_energy")).toBe("20"); // §179D
    expect(by.get("f1065.line20")).toBe("21");
    expect(by.get("f1065.line21")).toBe("22");
    expect(by.get("f1065.line22")).toBe("23");
  });

  it("1065 total-deductions relation includes §179D for 2023, not for 2022", () => {
    const rel23 = getRegistryEntry("1065", 2023)!.relations.find(
      (r) => r.id === "1065.total_deductions",
    )!;
    expect(rel23.operands).toContain("f1065.line20_energy");
    const rel22 = getRegistryEntry("1065", 2022)!.relations.find(
      (r) => r.id === "1065.total_deductions",
    )!;
    expect(rel22.operands).not.toContain("f1065.line20_energy");
  });

  it("1120-S 2021 resolves with pre-§179D numbering", () => {
    const e = getRegistryEntry("1120S", 2021);
    expect(e).not.toBeNull();
    const by = new Map(e!.fields.map((f) => [f.fieldId, f.lineNumber]));
    expect(by.get("f1120s.line19")).toBe("19"); // Other deductions
    expect(by.get("f1120s.line20")).toBe("20"); // Total deductions
    expect(by.get("f1120s.line21")).toBe("21"); // Ordinary business income
    expect(by.has("f1120s.line19_energy")).toBe(false);
  });

  it("1120-S total-deductions relation includes §179D only from 2023", () => {
    const rel23 = getRegistryEntry("1120S", 2023)!.relations.find(
      (r) => r.id === "1120s.total_deductions",
    )!;
    expect(rel23.operands).toContain("f1120s.line19_energy");
    const rel21 = getRegistryEntry("1120S", 2021)!.relations.find(
      (r) => r.id === "1120s.total_deductions",
    )!;
    expect(rel21.operands).not.toContain("f1120s.line19_energy");
  });

  it("1120 2020-2022 resolve unchanged (numbering verified stable)", () => {
    for (const year of [2020, 2021, 2022]) {
      const e = getRegistryEntry("1120", year);
      expect(e, `1120 ${year}`).not.toBeNull();
      const by = new Map(e!.fields.map((f) => [f.fieldId, f.lineNumber]));
      expect(by.get("f1120.line30")).toBe("30"); // Taxable income
    }
  });

  it("Schedule L is identical across all supported years (printed forms stable)", () => {
    for (const family of ["1120S", "1065"] as const) {
      const now = getRegistryEntry(family, 2023)!.fields.filter((f) => f.fieldId.includes("schl"));
      const then_ = getRegistryEntry(family, 2021)!.fields.filter((f) =>
        f.fieldId.includes("schl"),
      );
      expect(then_).toEqual(now);
    }
  });
});
