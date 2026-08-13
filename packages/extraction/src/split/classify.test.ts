import { describe, expect, it } from "vitest";
import { AnthropicPageClassifier, validateLlmClaim, type ClassifierUsage } from "./classify.js";

/** Recorded Messages API response (structured output) — synthetic fixture. */
const RECORDED_RESPONSE = {
  id: "msg_recorded_002",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        pages: [
          {
            page: 39,
            form_family: "PNL",
            printed_form: null,
            tax_year: null,
            is_document_start: false,
            confidence: 0.8,
          },
          {
            page: 54,
            form_family: null,
            printed_form: null,
            tax_year: null,
            is_document_start: false,
            confidence: 0.1,
          },
        ],
      }),
    },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 900, output_tokens: 60 },
};

function recordedFetch(capture?: { body?: unknown }, usage?: Record<string, number>): typeof fetch {
  return async (_url, init) => {
    if (capture && init?.body) capture.body = JSON.parse(init.body as string);
    const response = usage ? { ...RECORDED_RESPONSE, usage } : RECORDED_RESPONSE;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("AnthropicPageClassifier (recorded responses — no live calls)", () => {
  it("classifies text pages, tolerating a null/unknown family from the model", async () => {
    const classifier = new AnthropicPageClassifier({ apiKey: "test", fetch: recordedFetch() });
    const result = await classifier.classifyPages([
      { page: 39, text: "Utilities 4,200\nRent 36,000" },
      { page: 54, text: "handwritten margin notes" },
    ]);
    expect(result[0]).toMatchObject({ page: 39, formFamily: "PNL", method: "llm" });
    // A null family is an abstention - it carries no confidence (M13.1).
    expect(result[1]).toMatchObject({ page: 54, formFamily: null, confidence: 0 });
  });

  it("uses a Haiku-class model with structured outputs (Blueprint §4.1)", async () => {
    const capture: { body?: unknown } = {};
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: recordedFetch(capture),
    });
    await classifier.classifyPages([{ page: 1, text: "x" }]);
    const body = capture.body as Record<string, unknown>;
    expect(body["model"]).toBe("claude-haiku-4-5");
    expect((body["output_config"] as Record<string, unknown>)["format"]).toMatchObject({
      type: "json_schema",
    });
  });

  it("reports token usage through onUsage (M3.2 cost recording seam)", async () => {
    const seen: ClassifierUsage[] = [];
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: recordedFetch(),
      onUsage: (u) => seen.push(u),
    });
    await classifier.classifyPages([{ page: 1, text: "x" }]);
    // Cache fields absent from the response report as 0, never undefined.
    expect(seen).toEqual([
      {
        model: "claude-haiku-4-5",
        inputTokens: 900,
        outputTokens: 60,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    ]);
  });

  it("reports prompt-cache tokens through onUsage - cached calls are real spend", async () => {
    const seen: ClassifierUsage[] = [];
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: recordedFetch(undefined, {
        input_tokens: 100,
        output_tokens: 60,
        cache_creation_input_tokens: 800,
        cache_read_input_tokens: 12_000,
      }),
      onUsage: (u) => seen.push(u),
    });
    await classifier.classifyPages([{ page: 1, text: "x" }]);
    expect(seen).toEqual([
      {
        model: "claude-haiku-4-5",
        inputTokens: 100,
        outputTokens: 60,
        cacheCreationInputTokens: 800,
        cacheReadInputTokens: 12_000,
      },
    ]);
  });

  it("marks the system prompt as a prompt-cache prefix (ephemeral)", async () => {
    const capture: { body?: unknown } = {};
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: recordedFetch(capture),
    });
    await classifier.classifyPages([{ page: 1, text: "x" }]);
    const body = capture.body as { system: { text: string; cache_control?: unknown }[] };
    expect(body.system).toHaveLength(1);
    expect(body.system[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("sends page images when provided (vision path)", async () => {
    const capture: { body?: unknown } = {};
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: recordedFetch(capture),
    });
    await classifier.classifyPages([
      { page: 1, text: "scanned", imagePng: new Uint8Array([0x89, 0x50]) },
    ]);
    const body = capture.body as { messages: Array<{ content: Array<{ type: string }> }> };
    expect(body.messages[0]?.content.some((c) => c.type === "image")).toBe(true);
  });
});

/* The exact page text that produced the bug: Form 1120 page 1, whose only
 * mention of 1125-E is the line-12 citation. The deterministic layer
 * abstains here; the vision model claimed 1125E on the first real deal. */
const F1120_PAGE1_TEXT =
  "Form 1120 U.S. Corporation Income Tax Return OMB No. 1545-0123 2023\n" +
  "1a Gross receipts or sales 1,500,000,000\n" +
  "12 Compensation of officers (see instructions - attach Form 1125-E)\n" +
  "20 Depreciation from Form 4562 not claimed elsewhere (attach Form 4562)";

describe("validateLlmClaim - structural guards (M13.1, first-deal walkthrough)", () => {
  it("vetoes a claim whose only textual basis is a citation (the 1125-E bug)", () => {
    expect(
      validateLlmClaim({ form_family: "1125E", printed_form: "1125-E" }, F1120_PAGE1_TEXT),
    ).toBeNull();
  });

  it("vetoes a family that contradicts the printed form (the 4626→4562 bug)", () => {
    const amtPage = "Form 4626 Alternative Minimum Tax - Corporations OMB No. 1545-0123";
    expect(validateLlmClaim({ form_family: "4562", printed_form: "4626" }, amtPage)).toBeNull();
    expect(validateLlmClaim({ form_family: "1120", printed_form: "4626" }, amtPage)).toBeNull();
  });

  it("labels 4626 honestly when print and claim agree", () => {
    expect(
      validateLlmClaim(
        { form_family: "4626", printed_form: "4626" },
        "Form 4626 Alternative Minimum Tax - Corporations OMB No. 1545-0123",
      ),
    ).toBe("4626");
  });

  it("an unknown printed form abstains, never snaps to a neighbor", () => {
    expect(
      validateLlmClaim(
        { form_family: "1120", printed_form: "5472" },
        "Form 5472 Information Return of a 25% Foreign-Owned U.S. Corporation",
      ),
    ).toBeNull();
  });

  it("a tax-form claim without a printed identity abstains", () => {
    expect(validateLlmClaim({ form_family: "1120", printed_form: null }, "cover page")).toBeNull();
  });

  it("NON_FORM and statement families need no printed token", () => {
    expect(validateLlmClaim({ form_family: "NON_FORM", printed_form: null }, "FAX COVER")).toBe(
      "NON_FORM",
    );
    expect(
      validateLlmClaim({ form_family: "PNL", printed_form: null }, "Statement of Operations"),
    ).toBe("PNL");
  });

  it("image-only evidence stands: a W-2 claim survives an absent text token", () => {
    // Garbled scan - the text layer never says W-2; the vision model saw it.
    expect(validateLlmClaim({ form_family: "W2", printed_form: "W-2" }, "22222 gar bled")).toBe(
      "W2",
    );
  });

  it("an unknown family string abstains", () => {
    expect(validateLlmClaim({ form_family: "8949", printed_form: "8949" }, "Form 8949")).toBeNull();
  });
});

describe("AnthropicPageClassifier applies the guards to model output", () => {
  const vetoResponse = {
    ...RECORDED_RESPONSE,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          pages: [
            {
              page: 2,
              form_family: "1125E",
              printed_form: "1125-E",
              tax_year: 2023,
              is_document_start: true,
              confidence: 0.85,
            },
          ],
        }),
      },
    ],
  };

  it("a vetoed claim comes back null with the veto recorded", async () => {
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: async () =>
        new Response(JSON.stringify(vetoResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const [r] = await classifier.classifyPages([{ page: 2, text: F1120_PAGE1_TEXT }]);
    expect(r).toMatchObject({
      page: 2,
      formFamily: null,
      confidence: 0,
      isDocumentStart: false,
    });
    expect(r?.matched).toContain("llm-vetoed:1125E");
  });
});

describe("scanned bundles: page binding and batching (M13.6)", () => {
  const png = new Uint8Array([137, 80, 78, 71]);

  it("names the page BEFORE its image, never relying on block order (Iron Law #4)", async () => {
    const capture: { body?: unknown } = {};
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: recordedFetch(capture),
    });
    await classifier.classifyPages([
      { page: 7, text: "", imagePng: png },
      { page: 8, text: "", imagePng: png },
    ]);
    const content = (capture.body as { messages: { content: { type: string; text?: string }[] }[] })
      .messages[0]!.content;
    const imageAt = content.findIndex((b) => b.type === "image");
    // The block immediately before the first image must identify its page,
    // and the block after must reassert it. Without this an all-scan bundle
    // binds images to pages purely by position.
    expect(content[imageAt - 1]?.text).toContain("PAGE 7");
    expect(content[imageAt + 1]?.text).toContain("page 7");
  });

  it("batches by IMAGE count so text-only pages ride along free", async () => {
    let requests = 0;
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: async (_u, init) => {
        requests += 1;
        return recordedFetch()(_u, init);
      },
    });
    // 30 text pages + 5 scans. Counting PAGES would fire 9 requests; counting
    // images fires 2.
    const pages = [
      ...Array.from({ length: 30 }, (_, i) => ({ page: i + 1, text: "Form 1120 text" })),
      ...Array.from({ length: 5 }, (_, i) => ({ page: 31 + i, text: "", imagePng: png })),
    ];
    await classifier.classifyPages(pages);
    expect(requests).toBeLessThanOrEqual(2);
  });

  it("a failed batch degrades to unresolved instead of losing the bundle", async () => {
    // Fail every attempt for the batch containing page 1 (the SDK retries,
    // so a single throw would just be retried into success). Later batches
    // succeed - the point is that they still run and still return.
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: async (_u, init) => {
        const body = String(init?.body ?? "");
        if (body.includes("PAGE 1 ---")) throw new Error("529 overloaded");
        return recordedFetch()(_u, init);
      },
    });
    const pages = Array.from({ length: 10 }, (_, i) => ({
      page: i + 1,
      text: "",
      imagePng: png,
    }));
    const out = await classifier.classifyPages(pages);
    expect(out).toHaveLength(10);
    const failed = out.filter((c) => c.matched.some((m) => m.startsWith("llm-error")));
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((c) => c.formFamily === null && c.confidence === 0)).toBe(true);
  });
});
