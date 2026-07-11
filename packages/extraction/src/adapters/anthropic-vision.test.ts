import { describe, expect, it } from "vitest";
import { AnthropicVisionAdapter } from "./anthropic-vision.js";
import { assertFieldContract } from "../contract/assertions.js";
import type { FieldRequest } from "../types.js";

const FIELDS: FieldRequest[] = [
  { fieldId: "f1120s.line21", label: "Ordinary business income (loss)", dtype: "money" },
  { fieldId: "f1120s.line7", label: "Compensation of officers", dtype: "money" },
  { fieldId: "f1120s.line19", label: "Other deductions", dtype: "money" },
];

/** Recorded Messages API response (structured output) — synthetic fixture. */
const RECORDED_RESPONSE = {
  id: "msg_recorded_001",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        candidates: [
          {
            field_id: "f1120s.line21",
            value_text: "(1,234)",
            cents_box_text: null,
            page: 1,
            confidence: 0.97,
          },
          {
            field_id: "f1120s.line7",
            value_text: "185,000",
            cents_box_text: "00",
            page: 1,
            confidence: 0.97,
          },
          {
            field_id: "f1120s.line19",
            value_text: null,
            cents_box_text: null,
            page: null,
            confidence: 0.2,
          },
        ],
      }),
    },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 2000, output_tokens: 150 },
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

const DOC = {
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  mimeType: "application/pdf" as const,
  pageCount: 5,
};

describe("AnthropicVisionAdapter (recorded responses — no live calls)", () => {
  it("satisfies the field-extraction contract", async () => {
    const adapter = new AnthropicVisionAdapter({ apiKey: "test-key", fetch: recordedFetch() });
    const result = await adapter.extractFields(DOC, FIELDS);
    assertFieldContract(result, FIELDS);
  });

  it("preserves RAW value text verbatim — no normalization in the adapter", async () => {
    const adapter = new AnthropicVisionAdapter({ apiKey: "test-key", fetch: recordedFetch() });
    const result = await adapter.extractFields(DOC, FIELDS);
    expect(result.candidates[0]?.valueText).toBe("(1,234)"); // parens intact
    expect(result.candidates[1]?.valueText).toBe("185,000"); // comma intact
    expect(result.candidates[1]?.centsBoxText).toBe("00");
  });

  it("absent field → null value, null page (never guesses)", async () => {
    const adapter = new AnthropicVisionAdapter({ apiKey: "test-key", fetch: recordedFetch() });
    const result = await adapter.extractFields(DOC, FIELDS);
    const absent = result.candidates[2];
    expect(absent?.valueText).toBeNull();
    expect(absent?.page).toBeNull();
    expect(absent?.bbox).toBeNull();
  });

  it("computes cost from real token usage in integer micro-USD", async () => {
    const adapter = new AnthropicVisionAdapter({ apiKey: "test-key", fetch: recordedFetch() });
    const result = await adapter.extractFields(DOC, FIELDS);
    // 2000 in @ $3/MTok + 150 out @ $15/MTok = 6000 + 2250 = 8250 µ$
    expect(result.run.costMicroUsd).toBe(8250n);
  });

  it("sends structured outputs + disabled thinking + frozen system prompt (no sampling params)", async () => {
    const capture: { body?: unknown } = {};
    const adapter = new AnthropicVisionAdapter({
      apiKey: "test-key",
      fetch: recordedFetch(capture),
    });
    await adapter.extractFields(DOC, FIELDS);
    const body = capture.body as Record<string, unknown>;
    expect(body["model"]).toBe("claude-sonnet-5");
    expect(body["thinking"]).toEqual({ type: "disabled" });
    expect(body["temperature"]).toBeUndefined(); // removed on current models
    expect((body["output_config"] as Record<string, unknown>)["format"]).toMatchObject({
      type: "json_schema",
    });
    expect(String(body["system"])).toContain("NEVER");
  });

  it("refuses to parse layout (that is the layout vendor's job)", async () => {
    const adapter = new AnthropicVisionAdapter({ apiKey: "test-key", fetch: recordedFetch() });
    await expect(adapter.parseLayout(DOC)).rejects.toThrow(/layout/);
  });
});
