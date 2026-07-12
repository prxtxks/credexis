import { describe, expect, it } from "vitest";
import {
  AnthropicLabelClassifier,
  confirmMapping,
  InMemoryMappingsStore,
  mapLabels,
  normalizeLabel,
  similarity,
  type LabelClassifier,
} from "./taxonomy-mapper.js";

/** Counting stub — the cost-decay meter. */
function stubClassifier(answers: Record<string, string | null>) {
  const calls: string[][] = [];
  const classifier: LabelClassifier = {
    classifyLabels: (labels) => {
      calls.push(labels);
      return Promise.resolve(
        labels.map((label) => ({
          label,
          taxonomyNodeKey: answers[label] ?? null,
          confidence: answers[label] ? 0.85 : 0.1,
        })),
      );
    },
  };
  return { classifier, calls };
}

describe("taxonomy mapper (M5.4) — resolution order", () => {
  it("tenant exact → fuzzy → global exact → fuzzy → LLM → unmapped", async () => {
    const store = new InMemoryMappingsStore();
    await store.upsert("t1", {
      labelNorm: "officer compensation",
      taxonomyNodeKey: "is.opex.officer_comp",
      confidence: 1,
      source: "human",
      usageCount: 5,
    });
    await store.upsert(null, {
      labelNorm: "rent expense",
      taxonomyNodeKey: "is.opex.rent",
      confidence: 0.9,
      source: "human",
      usageCount: 40,
    });
    const { classifier, calls } = stubClassifier({ "Fuel Surcharges": "is.opex.fuel" });

    const mapped = await mapLabels(
      [
        "Officer Compensation", // tenant exact (after normalization)
        "Officer's Compensation", // tenant fuzzy ≥95 (apostrophe-s)
        "Rent Expense", // global exact
        "Fuel Surcharges", // LLM
        "Zorble Fees", // unmapped → review
      ],
      "PNL",
      "t1",
      store,
      classifier,
    );

    expect(mapped.map((m) => m.method)).toEqual([
      "exact_tenant",
      "fuzzy_tenant",
      "exact_global",
      "llm",
      "unmapped",
    ]);
    expect(mapped[1]?.taxonomyNodeKey).toBe("is.opex.officer_comp");
    expect(mapped[4]?.taxonomyNodeKey).toBeNull();
    // Only the labels the learned pools couldn't resolve reached the LLM.
    expect(calls).toEqual([["Fuel Surcharges", "Zorble Fees"]]);
  });

  it("COST DECAY: the second identical document uses ZERO LLM calls", async () => {
    const store = new InMemoryMappingsStore();
    const { classifier, calls } = stubClassifier({
      "Fuel Surcharges": "is.opex.fuel",
      "Shop Supplies": "is.opex.supplies",
    });
    const labels = ["Fuel Surcharges", "Shop Supplies"];

    const first = await mapLabels(labels, "PNL", "t1", store, classifier);
    expect(first.every((m) => m.method === "llm")).toBe(true);
    expect(calls).toHaveLength(1);

    const second = await mapLabels(labels, "PNL", "t1", store, classifier);
    expect(second.every((m) => m.method === "exact_tenant")).toBe(true);
    expect(calls).toHaveLength(1); // ← zero additional LLM calls
  });

  it("human confirmation upgrades LLM mappings and is never downgraded", async () => {
    const store = new InMemoryMappingsStore();
    const { classifier } = stubClassifier({ "Misc Fees": "is.opex.misc" });
    await mapLabels(["Misc Fees"], "PNL", "t1", store, classifier);

    await confirmMapping(store, "t1", "Misc Fees", "is.opex.bank_charges"); // human corrects
    const m = await store.findExact("t1", "misc fees");
    expect(m).toMatchObject({ taxonomyNodeKey: "is.opex.bank_charges", source: "human" });

    // A later LLM write-back must not clobber the human decision.
    await store.upsert("t1", {
      labelNorm: "misc fees",
      taxonomyNodeKey: "is.opex.misc",
      confidence: 0.8,
      source: "llm",
      usageCount: 1,
    });
    expect((await store.findExact("t1", "misc fees"))?.taxonomyNodeKey).toBe(
      "is.opex.bank_charges",
    );
  });

  it("no classifier configured → unresolved labels go straight to review", async () => {
    const mapped = await mapLabels(["Whatever"], "PNL", "t1", new InMemoryMappingsStore(), null);
    expect(mapped[0]).toMatchObject({ method: "unmapped", taxonomyNodeKey: null });
  });
});

describe("normalization + fuzzy bar", () => {
  it("normalizes case, punctuation, whitespace", () => {
    expect(normalizeLabel("  Officer's   Compensation!! ")).toBe("officers compensation");
  });
  it("the ≥95 bar: near-identical passes, sibling labels do not", () => {
    expect(similarity("officers compensation", "officer compensation")).toBeGreaterThanOrEqual(
      0.95,
    );
    expect(similarity("interest income", "interest expense")).toBeLessThan(0.95);
  });
});

describe("AnthropicLabelClassifier (recorded response — no live calls)", () => {
  it("sends LABELS ONLY — the request body carries no amounts", async () => {
    const capture: { body?: string } = {};
    const recorded = {
      id: "msg_r3",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            mappings: [{ label: "Fuel", taxonomy_node: "is.opex.fuel", confidence: 0.9 }],
          }),
        },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 500, output_tokens: 40 },
    };
    const classifier = new AnthropicLabelClassifier({
      apiKey: "test",
      fetch: async (_url, init) => {
        capture.body = init?.body as string;
        return new Response(JSON.stringify(recorded), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const out = await classifier.classifyLabels(["Fuel"], "PNL");
    expect(out[0]).toMatchObject({ taxonomyNodeKey: "is.opex.fuel" });
    // Iron Law #1: the LLM never sees the numbers.
    expect(capture.body).not.toMatch(/36,000|1,000,000|\$\d/);
    expect(capture.body).toContain("- Fuel");
  });

  it("rejects hallucinated node keys (enum guard)", async () => {
    const recorded = {
      id: "msg_r4",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            mappings: [{ label: "X", taxonomy_node: "is.opex.made_up_node", confidence: 0.9 }],
          }),
        },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const classifier = new AnthropicLabelClassifier({
      apiKey: "test",
      fetch: async () =>
        new Response(JSON.stringify(recorded), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const out = await classifier.classifyLabels(["X"], "PNL");
    expect(out[0]?.taxonomyNodeKey).toBeNull(); // unknown key → review, not trust
  });
});
