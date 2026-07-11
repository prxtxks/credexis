import { describe, expect, it } from "vitest";
import { AzureDocumentIntelligenceAdapter } from "./azure-document-intelligence.js";
import { assertFieldContract, assertLayoutContract } from "../contract/assertions.js";
import type { FieldRequest } from "../types.js";

// Registry supplies Azure's vendor field names via aliases (M4.1).
const FIELDS: FieldRequest[] = [
  {
    fieldId: "w2.box1",
    label: "Wages, tips, other compensation",
    aliases: ["WagesTipsAndOtherCompensation"],
    dtype: "money",
  },
  { fieldId: "w2.box14", label: "Other", aliases: ["Other"], dtype: "text" },
];

/** Recorded analyze result (api-version 2024-11-30 shape; letter page 8.5×11in). */
const SUCCEEDED = {
  status: "succeeded",
  analyzeResult: {
    pages: [
      {
        pageNumber: 1,
        width: 8.5,
        height: 11,
        lines: [
          {
            content: "Form W-2 Wage and Tax Statement",
            polygon: [0.5, 0.4, 4.2, 0.4, 4.2, 0.7, 0.5, 0.7],
          },
        ],
      },
    ],
    tables: [
      {
        boundingRegions: [{ pageNumber: 1, polygon: [0.5, 1, 8, 1, 8, 5, 0.5, 5] }],
        cells: [
          {
            rowIndex: 0,
            columnIndex: 0,
            content: "1 Wages, tips, other comp.",
            boundingRegions: [{ pageNumber: 1, polygon: [0.5, 1, 4, 1, 4, 1.4, 0.5, 1.4] }],
          },
          {
            rowIndex: 0,
            columnIndex: 1,
            content: "48,500.00",
            boundingRegions: [{ pageNumber: 1, polygon: [4, 1, 8, 1, 8, 1.4, 4, 1.4] }],
          },
        ],
      },
    ],
    documents: [
      {
        fields: {
          WagesTipsAndOtherCompensation: {
            valueString: "48,500.00",
            confidence: 0.99,
            boundingRegions: [
              { pageNumber: 1, polygon: [4.25, 1.1, 6.8, 1.1, 6.8, 1.32, 4.25, 1.32] },
            ],
          },
          // "Other" absent on this W-2 — not in the response at all.
        },
      },
    ],
  },
};

function recordedFetch(): typeof fetch {
  return async (url, init) => {
    if (init?.method === "POST") {
      return new Response(null, {
        status: 202,
        headers: { "operation-location": "https://recorded.local/op/1" },
      });
    }
    return new Response(JSON.stringify(SUCCEEDED), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const DOC = { bytes: new Uint8Array([0x25]), mimeType: "application/pdf" as const };

function makeAdapter() {
  return new AzureDocumentIntelligenceAdapter({
    endpoint: "https://recorded.cognitiveservices.azure.com",
    apiKey: "test",
    fetch: recordedFetch(),
    pollIntervalMs: 0,
  });
}

describe("AzureDocumentIntelligenceAdapter (recorded responses — no live calls)", () => {
  it("satisfies the field-extraction contract (async analyze + poll)", async () => {
    const result = await makeAdapter().extractFields(DOC, FIELDS);
    assertFieldContract(result, FIELDS);
  });

  it("resolves vendor field names via registry aliases; absent field → null", async () => {
    const result = await makeAdapter().extractFields(DOC, FIELDS);
    expect(result.candidates[0]?.valueText).toBe("48,500.00"); // raw, unnormalized
    expect(result.candidates[0]?.confidence).toBeCloseTo(0.99);
    expect(result.candidates[1]?.valueText).toBeNull();
    expect(result.candidates[1]?.confidence).toBe(0);
  });

  it("normalizes inch polygons into the shared [0,1] top-left bbox space", async () => {
    const result = await makeAdapter().extractFields(DOC, FIELDS);
    const bbox = result.candidates[0]?.bbox;
    expect(bbox?.x).toBeCloseTo(4.25 / 8.5); // 0.5
    expect(bbox?.y).toBeCloseTo(1.1 / 11); // 0.1
    expect(bbox?.w).toBeCloseTo((6.8 - 4.25) / 8.5, 5);
  });

  it("satisfies the layout contract with geometry-keyed table cells", async () => {
    const result = await makeAdapter().parseLayout(DOC);
    assertLayoutContract(result);
    expect(result.pages[0]?.tables[0]?.cells[1]).toMatchObject({
      text: "48,500.00",
      rowIndex: 0,
      colIndex: 1,
    });
  });
});
