import { describe, expect, it } from "vitest";
import { AnthropicPageClassifier } from "./classify.js";

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
            tax_year: null,
            is_document_start: false,
            confidence: 0.8,
          },
          {
            page: 54,
            form_family: null,
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

function recordedFetch(capture?: { body?: unknown }): typeof fetch {
  return async (_url, init) => {
    if (capture && init?.body) capture.body = JSON.parse(init.body as string);
    return new Response(JSON.stringify(RECORDED_RESPONSE), {
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
    expect(result[1]).toMatchObject({ page: 54, formFamily: null, confidence: 0.1 });
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
    const seen: { model: string; inputTokens: number; outputTokens: number }[] = [];
    const classifier = new AnthropicPageClassifier({
      apiKey: "test",
      fetch: recordedFetch(),
      onUsage: (u) => seen.push(u),
    });
    await classifier.classifyPages([{ page: 1, text: "x" }]);
    expect(seen).toEqual([{ model: "claude-haiku-4-5", inputTokens: 900, outputTokens: 60 }]);
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
