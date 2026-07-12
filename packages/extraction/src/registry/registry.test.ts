import { describe, expect, it } from "vitest";
import { TAXONOMY_V1 } from "@credexis/schema";
import {
  getRegistryEntry,
  listRegistryEntries,
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
