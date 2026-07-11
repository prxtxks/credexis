import { describe, expect, it } from "vitest";
import { ReductoAdapter } from "./reducto.js";
import { assertFieldContract, assertLayoutContract } from "../contract/assertions.js";
import type { FieldRequest } from "../types.js";

const FIELDS: FieldRequest[] = [
  { fieldId: "f1120s.line21", label: "Ordinary business income (loss)", dtype: "money" },
  { fieldId: "f1120s.line19", label: "Other deductions", dtype: "money" },
];

/** Recorded /extract response shape (fixtures captured 2026-07; M3.4 verifies live). */
const EXTRACT_RESPONSE = {
  usage: { num_pages: 5 },
  result: [
    {
      field_id: "f1120s.line21",
      value: "(1,234)",
      bbox: { left: 0.62, top: 0.41, width: 0.18, height: 0.02, page: 1 },
      confidence: 0.96,
    },
    { field_id: "f1120s.line19", value: null, bbox: null, confidence: 0.1 },
  ],
};

/** Recorded /parse response shape. */
const PARSE_RESPONSE = {
  usage: { num_pages: 1 },
  result: {
    chunks: [
      {
        blocks: [
          {
            type: "Title",
            content: "ACME LLC — Profit & Loss",
            bbox: { left: 0.1, top: 0.05, width: 0.6, height: 0.03, page: 1 },
          },
          {
            type: "Table",
            content: "",
            bbox: { left: 0.08, top: 0.15, width: 0.84, height: 0.6, page: 1 },
            cells: [
              {
                content: "Revenue",
                bbox: { left: 0.08, top: 0.16, width: 0.3, height: 0.02, page: 1 },
                row: 0,
                col: 0,
              },
              {
                content: "1,020,000",
                bbox: { left: 0.7, top: 0.16, width: 0.2, height: 0.02, page: 1 },
                row: 0,
                col: 1,
              },
            ],
          },
        ],
      },
    ],
  },
};

function recordedFetch(): typeof fetch {
  return async (url) => {
    const path = new URL(String(url)).pathname;
    const body = path === "/extract" ? EXTRACT_RESPONSE : PARSE_RESPONSE;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const DOC = { bytes: new Uint8Array([0x25]), mimeType: "application/pdf" as const };

describe("ReductoAdapter (recorded responses — no live calls)", () => {
  it("satisfies the field-extraction contract", async () => {
    const adapter = new ReductoAdapter({ apiKey: "test", fetch: recordedFetch() });
    const result = await adapter.extractFields(DOC, FIELDS);
    assertFieldContract(result, FIELDS);
  });

  it("preserves raw text and carries vendor bbox + page", async () => {
    const adapter = new ReductoAdapter({ apiKey: "test", fetch: recordedFetch() });
    const result = await adapter.extractFields(DOC, FIELDS);
    const hit = result.candidates[0];
    expect(hit?.valueText).toBe("(1,234)");
    expect(hit?.page).toBe(1);
    expect(hit?.bbox).toMatchObject({ x: 0.62, y: 0.41 });
    expect(result.candidates[1]?.valueText).toBeNull();
  });

  it("prices by page count in integer micro-USD", async () => {
    const adapter = new ReductoAdapter({
      apiKey: "test",
      fetch: recordedFetch(),
      costMicroUsdPerPage: 20_000n,
    });
    const result = await adapter.extractFields(DOC, FIELDS);
    expect(result.run.costMicroUsd).toBe(100_000n); // 5 pages × $0.02
  });

  it("satisfies the layout contract: geometry-keyed cells, no ordinal guessing", async () => {
    const adapter = new ReductoAdapter({ apiKey: "test", fetch: recordedFetch() });
    const result = await adapter.parseLayout(DOC);
    assertLayoutContract(result);
    const table = result.pages[0]?.tables[0];
    expect(table?.cells).toHaveLength(2);
    // Cell identity is (row, col) + bbox — the value cell knows its column.
    expect(table?.cells[1]).toMatchObject({ text: "1,020,000", rowIndex: 0, colIndex: 1 });
  });
});
