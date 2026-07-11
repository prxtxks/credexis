import { describe, expect, it } from "vitest";
import { FIRST_CLASS_ADDBACK_KEYS, TAXONOMY_V1 } from "./taxonomy.js";
import { POLICY_PACK_2026_03, policyPackRulesSchema } from "./policy-pack.js";

describe("taxonomy v1 (M2.6)", () => {
  it("has ~200 nodes (Blueprint §4.3)", () => {
    expect(TAXONOMY_V1.length).toBeGreaterThanOrEqual(180);
    expect(TAXONOMY_V1.length).toBeLessThanOrEqual(230);
  });

  it("keys are unique, kebab/dotted, lowercase", () => {
    const keys = TAXONOMY_V1.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9_.]+$/);
  });

  it("every parentKey exists and precedes its children (seed order = FK order)", () => {
    const seen = new Set<string>();
    for (const n of TAXONOMY_V1) {
      if (n.parentKey !== null) {
        expect(seen.has(n.parentKey), `${n.key} → missing/late parent ${n.parentKey}`).toBe(true);
      }
      seen.add(n.key);
    }
  });

  it("children carry their parent's key as a prefix (paths are honest)", () => {
    for (const n of TAXONOMY_V1) {
      if (n.parentKey !== null) {
        expect(n.key.startsWith(`${n.parentKey}.`), `${n.key} not under ${n.parentKey}`).toBe(true);
      }
    }
  });

  it("officer comp, rent, D&A, interest are first-class addback nodes (Blueprint §4.3)", () => {
    const byKey = new Map(TAXONOMY_V1.map((n) => [n.key, n]));
    for (const key of FIRST_CLASS_ADDBACK_KEYS) {
      const node = byKey.get(key);
      expect(node, `missing ${key}`).toBeDefined();
      expect(node?.isAddbackRelevant, `${key} must be addback-relevant`).toBe(true);
    }
  });

  it("core statement structure is present (mapper targets, gate anchors)", () => {
    const keys = new Set(TAXONOMY_V1.map((n) => n.key));
    for (const required of [
      "is.revenue.total",
      "is.cogs.total",
      "is.gross_profit",
      "is.opex.total",
      "is.net_income",
      "bs.assets.total",
      "bs.liabilities.total",
      "bs.equity.total",
      "bs.total_liabilities_equity",
      "pcf.income.total",
      "pcf.outflow.total",
      "debt.total_payments",
    ]) {
      expect(keys.has(required), `missing ${required}`).toBe(true);
    }
  });

  it("sortOrder is unique among siblings", () => {
    const bySibling = new Map<string, Set<number>>();
    for (const n of TAXONOMY_V1) {
      const group = n.parentKey ?? "(root)";
      const set = bySibling.get(group) ?? new Set<number>();
      expect(set.has(n.sortOrder), `${n.key}: duplicate sortOrder in ${group}`).toBe(false);
      set.add(n.sortOrder);
      bySibling.set(group, set);
    }
  });
});

describe("policy pack v2026-03 (M2.6, Iron Law #8)", () => {
  it("validates against the rules schema", () => {
    expect(() => policyPackRulesSchema.parse(POLICY_PACK_2026_03)).not.toThrow();
  });

  it("is DRAFT until [PRATIK] reviews it — the engine must not certify under draft", () => {
    expect(POLICY_PACK_2026_03.reviewStatus).toBe("draft");
    expect(POLICY_PACK_2026_03.reviewedBy).toBeNull();
  });

  it("encodes the task's headline thresholds exactly (no floats anywhere)", () => {
    const byId = new Map(POLICY_PACK_2026_03.rules.map((r) => [r.id, r]));
    expect(byId.get("dscr.standard")?.ratio).toEqual({ mantissa: 115, scale: 2 });
    expect(byId.get("dscr.small_loan")?.ratio).toEqual({ mantissa: 110, scale: 2 });
    expect(byId.get("dscr.small_loan")?.appliesWhen.loanAmountCentsLte).toBe("35000000");
    expect(byId.get("equity_injection.change_of_ownership")?.bps).toBe(1000);
    expect(byId.get("term.real_estate")?.months).toBe(300);
    expect(byId.get("term.working_capital")?.months).toBe(120);
  });

  it("every rule cites the SOP and uses exactly one value encoding", () => {
    for (const r of POLICY_PACK_2026_03.rules) {
      expect(r.sopCitation.length).toBeGreaterThan(10);
      const encodings = [r.ratio, r.bps, r.months, r.cents].filter((v) => v !== undefined);
      expect(encodings, `${r.id} must have exactly one value`).toHaveLength(1);
    }
  });

  it("no rule value is an IEEE float in disguise (money is cents-strings)", () => {
    const json = JSON.stringify(POLICY_PACK_2026_03);
    expect(json).not.toMatch(/\d+\.\d+/); // no decimal literals anywhere
  });
});
