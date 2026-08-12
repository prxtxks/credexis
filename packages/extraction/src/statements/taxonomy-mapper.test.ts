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
  it("strips QuickBooks account-code prefixes (annual P&L finding, 2026-07-22)", () => {
    expect(normalizeLabel("60400 Bank Service Charges")).toBe("bank service charges");
    expect(normalizeLabel("301.1 Cash Revenue")).toBe("cash revenue");
    expect(normalizeLabel("60100 · Payroll Expenses")).toBe("payroll expenses");
    expect(normalizeLabel("Total 63300 Insurance Expense")).toBe("total insurance expense");
    // Codes are LEADING 3-5 digit tokens only — never strip mid-label
    // numbers or digit-letter tokens.
    expect(normalizeLabel("Section 179 Deduction")).toBe("section 179 deduction");
    expect(normalizeLabel("401k Match")).toBe("401k match");
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

const classifyOnce = (c: AnthropicLabelClassifier) => c.classifyLabels(["Rent"], "PNL");

describe("cost levers (M10.5, verified live 2026-07-20)", () => {
  it("carries the chart-of-accounts prefix with a cache_control marker", async () => {
    const capture: { body?: string } = {};
    const recorded = {
      id: "msg_cache",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            mappings: [{ label: "Rent", taxonomy_node: "is.opex.rent", confidence: 0.95 }],
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
    await classifyOnce(classifier);
    const body = JSON.parse(capture.body!) as {
      system: { text: string; cache_control?: { type: string } }[];
    };
    expect(Array.isArray(body.system)).toBe(true);
    const cached = body.system.at(-1)!;
    expect(cached.cache_control).toEqual({ type: "ephemeral" });
    expect(cached.text).toContain("Chart of accounts");
    expect(cached.text).toContain("is.opex.royalties_franchise"); // guidance included
  });
});

describe("container-node guard (M14.7 - the $349 'Operating expenses' incident)", () => {
  // The Golden Deal P&L prints "General Business Expenses 349.00"; a
  // learned mapping pointed that label at is.opex - the CONTAINER - so
  // the spread showed 349.00 as Operating expenses' own value. A
  // statement fact on a node that has children is never a valid mapping:
  // containers aggregate, leaves carry values.
  it("demotes a learned mapping that targets a container to unmapped", async () => {
    const store = new InMemoryMappingsStore();
    await store.upsert("t-1", {
      labelNorm: normalizeLabel("General Business Expenses"),
      taxonomyNodeKey: "is.opex",
      confidence: 0.9,
      source: "llm",
      usageCount: 5,
    });
    const [m] = await mapLabels(["General Business Expenses"], "PNL", "t-1", store, null);
    expect(m!.taxonomyNodeKey).toBeNull();
    expect(m!.method).toBe("unmapped");
  });

  it("demotes an LLM answer that targets a container and never learns it", async () => {
    const store = new InMemoryMappingsStore();
    const classifier = {
      async classifyLabels(labels: string[]) {
        return labels.map((label) => ({ label, taxonomyNodeKey: "is.opex", confidence: 0.8 }));
      },
    };
    const [m] = await mapLabels(["Weird Aggregate Line"], "PNL", "t-1", store, classifier as never);
    expect(m!.taxonomyNodeKey).toBeNull();
    // The bad answer must not become a learned mapping either.
    expect(await store.findExact("t-1", normalizeLabel("Weird Aggregate Line"))).toBeNull();
  });

  it("leaf mappings pass through untouched", async () => {
    const store = new InMemoryMappingsStore();
    await store.upsert("t-1", {
      labelNorm: normalizeLabel("Rent"),
      taxonomyNodeKey: "is.opex.rent",
      confidence: 0.95,
      source: "human",
      usageCount: 3,
    });
    const [m] = await mapLabels(["Rent"], "PNL", "t-1", store, null);
    expect(m!.taxonomyNodeKey).toBe("is.opex.rent");
  });
});
