import { describe, expect, it } from "vitest";
import { pickBestMapping } from "./supabase.js";

const m = (over: Partial<Parameters<typeof pickBestMapping>[0][number]>) => ({
  labelNorm: "total assets",
  taxonomyNodeKey: "bs.assets.total",
  confidence: 0.9,
  source: "llm" as const,
  usageCount: 1,
  ...over,
});

describe("pickBestMapping (M14.3 - duplicate rows must not fail reads)", () => {
  it("returns null for no candidates", () => {
    expect(pickBestMapping([])).toBeNull();
  });

  // The production incident: "total assets" existed 16 times (NULL-tenant
  // rows bypass a plain UNIQUE index), and .maybeSingle() threw, failing
  // the whole statement extraction. Duplicates must degrade to best-wins.
  it("tolerates duplicates and picks the most-used", () => {
    const best = pickBestMapping([
      m({ usageCount: 2 }),
      m({ usageCount: 16, taxonomyNodeKey: "bs.assets.total" }),
      m({ usageCount: 5 }),
    ]);
    expect(best?.usageCount).toBe(16);
  });

  it("a human mapping beats any LLM usage count", () => {
    const best = pickBestMapping([
      m({ usageCount: 100, source: "llm" }),
      m({ usageCount: 1, source: "human", taxonomyNodeKey: "bs.assets.current.total" }),
    ]);
    expect(best?.source).toBe("human");
    expect(best?.taxonomyNodeKey).toBe("bs.assets.current.total");
  });
});
