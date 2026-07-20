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
