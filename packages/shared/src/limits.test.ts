import { describe, expect, it } from "vitest";
import { DEAL_LIMIT_DEFAULTS, resolveDealLimits } from "./limits.js";

describe("resolveDealLimits", () => {
  it("empty/absent settings → defaults", () => {
    expect(resolveDealLimits({})).toEqual(DEAL_LIMIT_DEFAULTS);
    expect(resolveDealLimits(null)).toEqual(DEAL_LIMIT_DEFAULTS);
    expect(resolveDealLimits(undefined)).toEqual(DEAL_LIMIT_DEFAULTS);
  });

  it("valid overrides are honored", () => {
    const r = resolveDealLimits({
      limits: { maxDocsPerDeal: 5, maxBytesPerDeal: 1000, maxCostMicroUsdPerDeal: 2_000_000 },
    });
    expect(r).toEqual({
      maxDocsPerDeal: 5,
      maxBytesPerDeal: 1000,
      maxCostMicroUsdPerDeal: 2_000_000n,
    });
  });

  it("malformed overrides can never turn limits off", () => {
    for (const bad of [0, -1, 1.5, "60", null, true, [], {}]) {
      const r = resolveDealLimits({
        limits: { maxDocsPerDeal: bad, maxBytesPerDeal: bad, maxCostMicroUsdPerDeal: bad },
      });
      expect(r).toEqual(DEAL_LIMIT_DEFAULTS);
    }
    expect(resolveDealLimits({ limits: "nope" })).toEqual(DEAL_LIMIT_DEFAULTS);
    expect(resolveDealLimits("garbage")).toEqual(DEAL_LIMIT_DEFAULTS);
  });
});
