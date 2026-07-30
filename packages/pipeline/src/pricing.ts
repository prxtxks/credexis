/**
 * Vendor API pricing → integer micro-USD (M3.2 cost discipline: every
 * external call is recorded; money is never a float). Prices are per
 * million tokens as published on the vendor price list - update the date
 * when updating a rate. Unknown models cost 0 and flag themselves in
 * metadata rather than inventing a rate.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** USD per 1M tokens, as of 2026-07-18 (platform.anthropic.com/pricing). */
const ANTHROPIC_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
};

/**
 * Integer micro-USD: rate is dollars per 1e6 tokens, so
 * micro-USD = tokens × rate - exact integer arithmetic, no floats needed
 * beyond the (integer-valued) published rates.
 */
export function anthropicCostMicroUsd(model: string, usage: TokenUsage): bigint {
  const rate = ANTHROPIC_PER_MTOK_USD[model];
  if (!rate) return 0n;
  return (
    BigInt(usage.inputTokens) * BigInt(rate.input) +
    BigInt(usage.outputTokens) * BigInt(rate.output)
  );
}

export function isPricedModel(model: string): boolean {
  return model in ANTHROPIC_PER_MTOK_USD;
}
