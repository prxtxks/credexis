import { describe, expect, it } from "vitest";
import { anthropicCostMicroUsd, isPricedModel } from "./pricing.js";

describe("anthropicCostMicroUsd", () => {
  it("prices plain input/output at the published per-MTok rates", () => {
    // 1M in × $1 + 1M out × $5 = $6 = 6,000,000 micro-USD (haiku rates).
    expect(
      anthropicCostMicroUsd("claude-haiku-4-5", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(6_000_000n);
  });

  it("prices prompt-cache tokens: writes at 1.25x input, reads at 0.1x", () => {
    // 1M cache writes × $1/MTok × 1.25 = $1.25 = 1,250,000 micro-USD.
    expect(
      anthropicCostMicroUsd("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 1_000_000,
        cacheReadInputTokens: 0,
      }),
    ).toBe(1_250_000n);
    // 1M cache reads × $1/MTok × 0.1 = $0.10 = 100,000 micro-USD.
    expect(
      anthropicCostMicroUsd("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 1_000_000,
      }),
    ).toBe(100_000n);
  });

  it("sums all four token kinds exactly (integer twentieths, one division)", () => {
    // Sonnet: in $3, out $15. 1000 in = 3000, 200 out = 3000,
    // 800 writes × 3 × 1.25 = 3000, 10000 reads × 3 × 0.1 = 3000 → 12,000.
    expect(
      anthropicCostMicroUsd("claude-sonnet-5", {
        inputTokens: 1000,
        outputTokens: 200,
        cacheCreationInputTokens: 800,
        cacheReadInputTokens: 10_000,
      }),
    ).toBe(12_000n);
  });

  it("floors sub-micro-USD remainders instead of rounding with floats", () => {
    // 1 cache write × $1/MTok = 1.25 micro-USD → floors to 1.
    expect(
      anthropicCostMicroUsd("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 1,
        cacheReadInputTokens: 0,
      }),
    ).toBe(1n);
  });

  it("treats absent cache fields as zero (pre-cache callers unchanged)", () => {
    expect(
      anthropicCostMicroUsd("claude-haiku-4-5", { inputTokens: 1000, outputTokens: 200 }),
    ).toBe(2000n);
  });

  it("prices unknown models at 0 rather than inventing a rate", () => {
    expect(
      anthropicCostMicroUsd("claude-nonexistent", {
        inputTokens: 1000,
        outputTokens: 1000,
        cacheCreationInputTokens: 1000,
        cacheReadInputTokens: 1000,
      }),
    ).toBe(0n);
    expect(isPricedModel("claude-nonexistent")).toBe(false);
  });
});
