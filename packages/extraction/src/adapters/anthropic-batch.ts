/**
 * Cost levers for Anthropic calls (M10.5 cost discipline):
 *
 * - `createMessage` sends a normal (sync) request.
 * - With `batch` set, the SAME params route through the Message Batches
 *   API — 50% off every token, at the price of polling latency. Only
 *   latency-tolerant callers (the eval harness, bake-offs) opt in; the
 *   live pipeline stays sync.
 *
 * Caching note: callers put static prefixes (system instructions, field
 * definitions, taxonomy lists) in system blocks marked
 * `cache_control: {type:"ephemeral"}`. Below the model's minimum
 * cacheable length the marker is a documented no-op — safe to set
 * unconditionally.
 */

import type Anthropic from "@anthropic-ai/sdk";

export interface BatchOptions {
  /** Poll interval while the batch processes (default 5s). */
  pollIntervalMs?: number;
  /** Give up after this long (default 15 min — batches can queue). */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createMessageMaybeBatch(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  batch: BatchOptions | null,
): Promise<{ message: Anthropic.Message; batched: boolean }> {
  if (!batch) {
    return { message: await client.messages.create(params), batched: false };
  }

  const created = await client.messages.batches.create({
    requests: [{ custom_id: "r0", params }],
  });

  const deadline = Date.now() + (batch.timeoutMs ?? 15 * 60_000);
  let current = created;
  while (current.processing_status === "in_progress") {
    if (Date.now() > deadline) {
      throw new Error(`anthropic batch ${created.id} timed out (still in_progress)`);
    }
    await sleep(batch.pollIntervalMs ?? 5_000);
    current = await client.messages.batches.retrieve(created.id);
  }

  for await (const entry of await client.messages.batches.results(created.id)) {
    if (entry.custom_id !== "r0") continue;
    if (entry.result.type === "succeeded") return { message: entry.result.message, batched: true };
    throw new Error(
      `anthropic batch request ${entry.result.type}: ${JSON.stringify(
        "error" in entry.result ? entry.result.error : {},
      ).slice(0, 200)}`,
    );
  }
  throw new Error(`anthropic batch ${created.id}: no result entry returned`);
}

/** Batch pricing is 50% of sync — applied at the caller's cost accounting. */
export const BATCH_DISCOUNT_NUM = 1n;
export const BATCH_DISCOUNT_DEN = 2n;

/** The usage block of a Messages API response (cache fields are nullable). */
export interface PricedUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Real-usage pricing in integer micro-USD. Cache tokens are real spend:
 * writes bill at 1.25x the input rate and reads at 0.1x (5-minute
 * ephemeral TTL — the only kind these adapters set), and the batch
 * discount covers every token. Exact integer math: 1.25 = 25/20 and
 * 0.1 = 2/20, so terms accumulate in twentieths of (tokens × rate per
 * MTok) and divide exactly once at the end.
 */
export function priceUsageMicroUsd(
  usage: PricedUsage,
  inputMicroUsdPerMtok: bigint,
  outputMicroUsdPerMtok: bigint,
  batched: boolean,
): bigint {
  const twentieths =
    (BigInt(usage.input_tokens) * inputMicroUsdPerMtok +
      BigInt(usage.output_tokens) * outputMicroUsdPerMtok) *
      20n +
    BigInt(usage.cache_creation_input_tokens ?? 0) * inputMicroUsdPerMtok * 25n +
    BigInt(usage.cache_read_input_tokens ?? 0) * inputMicroUsdPerMtok * 2n;
  const discounted = batched ? (twentieths * BATCH_DISCOUNT_NUM) / BATCH_DISCOUNT_DEN : twentieths;
  return discounted / 20_000_000n;
}
