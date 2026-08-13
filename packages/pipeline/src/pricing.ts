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
  /** Prompt-cache writes — billed at 1.25x the input rate. */
  cacheCreationInputTokens?: number;
  /** Prompt-cache reads — billed at 0.1x the input rate. */
  cacheReadInputTokens?: number;
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
 *
 * Cache tokens are real spend: writes bill at 1.25x the input rate and
 * reads at 0.1x (5-minute ephemeral TTL — the only kind we set). Both
 * multipliers are exact in twentieths (1.25 = 25/20, 0.1 = 2/20), so
 * terms accumulate in twentieths of a micro-USD and divide once at the
 * end — floor at micro-USD granularity, never a float.
 */
export function anthropicCostMicroUsd(model: string, usage: TokenUsage): bigint {
  const rate = ANTHROPIC_PER_MTOK_USD[model];
  if (!rate) return 0n;
  const twentieths =
    (BigInt(usage.inputTokens) * BigInt(rate.input) +
      BigInt(usage.outputTokens) * BigInt(rate.output)) *
      20n +
    BigInt(usage.cacheCreationInputTokens ?? 0) * BigInt(rate.input) * 25n +
    BigInt(usage.cacheReadInputTokens ?? 0) * BigInt(rate.input) * 2n;
  return twentieths / 20n;
}

export function isPricedModel(model: string): boolean {
  return model in ANTHROPIC_PER_MTOK_USD;
}
