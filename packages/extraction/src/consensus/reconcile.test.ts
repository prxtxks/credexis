import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { getRegistryEntry } from "../registry/loader.js";
import { registryEntrySchema } from "../registry/types.js";
import { reconcile } from "./reconcile.js";
import type { Bbox, FieldCandidate } from "../types.js";

const entry = getRegistryEntry("1120S", 2023)!;

const bbox = (y: number): Bbox => ({ x: 0.6, y, w: 0.2, h: 0.02 });

function candidateSet(
  values: Record<string, string | null>,
  opts: { withBbox?: boolean; overrides?: Record<string, string | null> } = {},
): FieldCandidate[] {
  return entry.fields.map((f, i) => {
    const text =
      opts.overrides && f.fieldId in opts.overrides
        ? (opts.overrides[f.fieldId] ?? null)
        : (values[f.fieldId] ?? null);
    return {
      fieldId: f.fieldId,
      valueText: text,
      centsBoxText: text !== null && f.hasCentsBox ? "00" : null,
      page: text !== null ? 1 : null,
      bbox: text !== null && opts.withBbox ? bbox(0.05 + i * 0.03) : null,
      confidence: text !== null ? 0.96 : 0.9,
    };
  });
}

/**
 * Planted 1120-S scenario:
 * - clean consensus on most lines
 * - 1c printed WRONG in agreement (985,000 vs 1a−1b=990,000) → relations
 *   'balance' and 'gross_profit' violated → wrong-in-agreement caught
 * - line5: paths disagree (10,000 vs 16,000)
 * - line9: only Path 1 reads a value
 * - line10: both read the ambiguous '1.020' → normalization rejects
 * - line21 = 6 − 20 holds → one passed relation
 */
const VALUES: Record<string, string | null> = {
  "f1120s.line1a": "1,000,000",
  "f1120s.line1b": "10,000",
  "f1120s.line1c": "985,000", // wrong-in-agreement (should be 990,000)
  "f1120s.line2": "400,000",
  "f1120s.line3": "590,000",
  "f1120s.line4": null,
  "f1120s.line5": "10,000",
  "f1120s.line6": "600,000",
  "f1120s.line7": "185,000",
  "f1120s.line8": "100,000",
  "f1120s.line9": "5,000",
  "f1120s.line10": "1.020", // ambiguous separator → unreadable
  "f1120s.line11": "36,000",
  "f1120s.line12": null,
  "f1120s.line13": "12,000",
  "f1120s.line14": "45,000",
  "f1120s.line15": null,
  "f1120s.line16": null,
  "f1120s.line17": null,
  "f1120s.line18": null,
  "f1120s.line19": "22,000",
  "f1120s.line20": "401,000",
  "f1120s.line21": "199,000",
};

const path1 = candidateSet(VALUES, { withBbox: true });
const path2 = candidateSet(VALUES, {
  overrides: { "f1120s.line5": "16,000", "f1120s.line9": null },
});

describe("consensus reconciler (M4.4) — planted 1120-S fixture", () => {
  const result = reconcile(path1, path2, entry);
  const byId = new Map(result.fields.map((f) => [f.fieldId, f]));

  it("agreement ⇒ consensus with cents value and Path-1 geometry", () => {
    const f = byId.get("f1120s.line7")!;
    expect(f.outcome).toBe("consensus");
    expect(f.valueCents).toBe(18500000n); // 185,000.00 via cents box
    expect(f.bbox).not.toBeNull();
    expect(f.bbox).toEqual(path1.find((c) => c.fieldId === "f1120s.line7")?.bbox);
    expect(f.confidence).toBeCloseTo(0.96);
  });

  it("both-blank ⇒ consensus_absent (agreement on absence is signal)", () => {
    const f = byId.get("f1120s.line4")!;
    expect(f.outcome).toBe("consensus_absent");
    expect(f.valueCents).toBeNull();
    expect(f.confidence).toBeGreaterThan(0);
  });

  it("disagreement ⇒ review with BOTH candidates, never a value", () => {
    const f = byId.get("f1120s.line5")!;
    expect(f.outcome).toBe("disagreement");
    expect(f.valueCents).toBeNull();
    expect(f.confidence).toBe(0);
    expect(f.path1?.cents).toBe(1000000n);
    expect(f.path2?.cents).toBe(1600000n);
    expect(f.path1?.rawText).toBe("10,000"); // raw preserved for the crop UI
  });

  it("single source ⇒ review, never auto-accept", () => {
    const f = byId.get("f1120s.line9")!;
    expect(f.outcome).toBe("single_source");
    expect(f.valueCents).toBeNull();
  });

  it("normalization rejection ⇒ unreadable (the ambiguous '1.020')", () => {
    const f = byId.get("f1120s.line10")!;
    expect(f.outcome).toBe("unreadable");
    expect(f.path1?.normalizationError).toBe("ambiguous_separator");
  });

  it("relations: wrong-in-agreement is caught by the third signal", () => {
    const checks = new Map(result.relationChecks.map((c) => [c.relationId, c]));
    expect(checks.get("1120s.balance")).toMatchObject({
      status: "violated",
      deltaCents: 500000n, // $5,000 off
    });
    expect(checks.get("1120s.gross_profit")?.status).toBe("violated");
    expect(checks.get("1120s.ordinary_income")?.status).toBe("passed"); // 199k = 600k − 401k
    // Relations touching unresolved fields don't pretend to know:
    expect(checks.get("1120s.total_income")?.status).toBe("skipped");
    expect(checks.get("1120s.total_deductions")?.status).toBe("skipped");
  });

  it("violated relations implicate their consensus fields (no auto-accept)", () => {
    for (const id of ["f1120s.line1a", "f1120s.line1b", "f1120s.line1c", "f1120s.line2"]) {
      expect(byId.get(id)?.implicatedByRelation, id).toBe(true);
    }
    expect(byId.get("f1120s.line7")?.implicatedByRelation).toBe(false);
    expect(byId.get("f1120s.line21")?.implicatedByRelation).toBe(false);
  });

  it("every registry field appears exactly once in the result", () => {
    expect(result.fields.map((f) => f.fieldId).sort()).toEqual(
      entry.fields.map((f) => f.fieldId).sort(),
    );
  });
});

/* ── property tests ─────────────────────────────────────────────────── */

const propEntry = registryEntrySchema.parse({
  formFamily: "W2",
  taxYear: 2023,
  revision: 1,
  fields: ["a", "b", "c"].map((n) => ({
    fieldId: `p.${n}`,
    lineNumber: n,
    label: `Field ${n}`,
    aliases: [],
    pageHint: 1,
    dtype: "money",
    sign: 1,
    hasCentsBox: false,
    taxonomyNodeKey: null,
  })),
  relations: [],
  flows: [],
});

/** Canonical dollar text from integer cents — always normalizes cleanly. */
const centsText = (c: bigint) =>
  `${c < 0n ? "-" : ""}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, "0")}`;

const arbCents = fc.bigInt({ min: -10_000_000_000n, max: 10_000_000_000n });
const arbMaybeCents = fc.option(arbCents, { nil: null });

function toCandidates(values: (bigint | null)[]): FieldCandidate[] {
  return propEntry.fields.map((f, i) => ({
    fieldId: f.fieldId,
    valueText: values[i] === null || values[i] === undefined ? null : centsText(values[i]),
    page: values[i] === null ? null : 1,
    bbox: null,
    confidence: 0.95,
  }));
}

describe("consensus reconciler — properties", () => {
  it("identical inputs never produce review outcomes", () => {
    fc.assert(
      fc.property(fc.array(arbMaybeCents, { minLength: 3, maxLength: 3 }), (vals) => {
        const cs = toCandidates(vals);
        const r = reconcile(cs, cs, propEntry);
        for (const f of r.fields) {
          expect(["consensus", "consensus_absent"]).toContain(f.outcome);
        }
      }),
    );
  });

  it("valueCents is populated iff outcome is consensus, and equals both paths", () => {
    fc.assert(
      fc.property(
        fc.array(arbMaybeCents, { minLength: 3, maxLength: 3 }),
        fc.array(arbMaybeCents, { minLength: 3, maxLength: 3 }),
        (v1, v2) => {
          const r = reconcile(toCandidates(v1), toCandidates(v2), propEntry);
          for (const f of r.fields) {
            if (f.outcome === "consensus") {
              expect(f.valueCents).not.toBeNull();
              expect(f.valueCents).toBe(f.path1?.cents);
              expect(f.valueCents).toBe(f.path2?.cents);
            } else {
              expect(f.valueCents).toBeNull();
            }
          }
        },
      ),
    );
  });

  it("differing non-null values are ALWAYS disagreement — never silently resolved", () => {
    fc.assert(
      fc.property(arbCents, arbCents, (a, b) => {
        fc.pre(a !== b);
        const r = reconcile(
          toCandidates([a, null, null]),
          toCandidates([b, null, null]),
          propEntry,
        );
        expect(r.fields[0]?.outcome).toBe("disagreement");
        expect(r.fields[0]?.valueCents).toBeNull();
      }),
    );
  });

  it("candidate array order never changes the result", () => {
    fc.assert(
      fc.property(fc.array(arbMaybeCents, { minLength: 3, maxLength: 3 }), (vals) => {
        const cs = toCandidates(vals);
        const shuffled = [...cs].reverse();
        const a = reconcile(cs, cs, propEntry);
        const b = reconcile(shuffled, shuffled, propEntry);
        expect(b.fields).toEqual(a.fields);
      }),
    );
  });

  it("junk candidates for unknown fieldIds are ignored", () => {
    const junk: FieldCandidate = {
      fieldId: "p.zzz",
      valueText: "999",
      page: 1,
      bbox: null,
      confidence: 1,
    };
    const cs = toCandidates([100n, null, null]);
    const r = reconcile([...cs, junk], cs, propEntry);
    expect(r.fields).toHaveLength(3);
    expect(r.fields.map((f) => f.fieldId)).not.toContain("p.zzz");
  });
});
