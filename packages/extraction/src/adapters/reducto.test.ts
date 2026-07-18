/**
 * Recorded-response tests for the Reducto adapter. Fixtures below are the
 * REAL shapes recorded from the live API on 2026-07-18 (see the live smoke
 * suite) — not guesses.
 */

import { describe, expect, it } from "vitest";
import { parseHtmlTable, ReductoAdapter } from "./reducto.js";
import { assertFieldContract, assertLayoutContract } from "../contract/assertions.js";
import type { FieldRequest } from "../types.js";

const FIELDS: FieldRequest[] = [
  { fieldId: "f1120s.line7", label: "7 Compensation of officers", dtype: "money" },
  { fieldId: "f1120s.line19", label: "19 Other deductions", dtype: "money" },
];

const UPLOAD_RESPONSE = { file_id: "reducto://recorded.pdf", presigned_url: null };

/** Recorded /parse shape (live, 2026-07-18). */
const PARSE_RESPONSE = {
  usage: { num_pages: 1, credits: 1 },
  result: {
    type: "full",
    chunks: [
      {
        content: "…",
        embed: "…",
        blocks: [
          {
            type: "Text",
            content: "SYNTHETIC FIXTURE — NOT A REAL DOCUMENT",
            bbox: {
              left: 0.088,
              top: 0.029,
              width: 0.352,
              height: 0.0088,
              page: 1,
              original_page: 1,
            },
            confidence: "low",
          },
          {
            type: "Table",
            content:
              "<table><tr><th>Form 1120-S</th><th>Tax year 2023</th></tr>" +
              "<tr><td>1a Gross receipts or sales</td><td>1,250,000.00</td></tr>" +
              "<tr><td>7 Compensation of officers</td><td>180,000.00</td></tr></table>",
            bbox: {
              left: 0.082,
              top: 0.049,
              width: 0.772,
              height: 0.155,
              page: 1,
              original_page: 1,
            },
            confidence: "high",
          },
        ],
      },
    ],
  },
};

/** Recorded /extract shape with generate_citations (live, 2026-07-18). */
const EXTRACT_RESPONSE = {
  usage: { num_pages: 1, num_fields: 2, credits: 3 },
  result: [{ f1120s__line7: "180,000.00", f1120s__line19: "" }],
  citations: [
    {
      f1120s__line7: [
        {
          type: "Table",
          content: "180,000.00",
          bbox: {
            left: 0.703,
            top: 0.137,
            width: 0.0808,
            height: 0.0094,
            page: 1,
            original_page: 1,
          },
          confidence: "high",
          granular_confidence: { extract_confidence: null, parse_confidence: 0.8777 },
        },
      ],
      f1120s__line19: [],
    },
  ],
};

function recordedFetch(): typeof fetch {
  return async (url) => {
    const path = new URL(String(url)).pathname;
    const body =
      path === "/upload"
        ? UPLOAD_RESPONSE
        : path === "/extract"
          ? EXTRACT_RESPONSE
          : PARSE_RESPONSE;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const DOC = { bytes: new Uint8Array([0x25]), mimeType: "application/pdf" as const };

describe("parseHtmlTable — vendor HTML structure is cell identity", () => {
  it("parses th/td rows and strips markup/entities", () => {
    const rows = parseHtmlTable(
      "<table><tr><th>Label</th><th>FY2023</th></tr><tr><td>Rent &amp; utilities</td><td>36,000</td></tr></table>",
    );
    expect(rows).toEqual([
      ["Label", "FY2023"],
      ["Rent & utilities", "36,000"],
    ]);
  });

  it("a BLANK <td> keeps its column position (post-mortem trap 1)", () => {
    const rows = parseHtmlTable("<tr><td>Rent</td><td>36,000</td><td></td><td>36,500</td></tr>");
    expect(rows[0]).toEqual(["Rent", "36,000", "", "36,500"]);
  });
});

describe("ReductoAdapter (recorded live shapes — no live calls in CI)", () => {
  it("extractFields: upload → extract → per-field bbox + confidence from citations", async () => {
    const adapter = new ReductoAdapter({ apiKey: "test", fetch: recordedFetch() });
    const result = await adapter.extractFields(DOC, FIELDS);
    assertFieldContract(result, FIELDS);
    const hit = result.candidates[0]!;
    expect(hit.valueText).toBe("180,000.00"); // raw, unnormalized
    expect(hit.page).toBe(1);
    expect(hit.bbox).toMatchObject({ x: 0.703 });
    expect(hit.confidence).toBeCloseTo(0.8777);
  });

  it("empty-string extraction → null candidate (absent, never guessed)", async () => {
    const adapter = new ReductoAdapter({ apiKey: "test", fetch: recordedFetch() });
    const result = await adapter.extractFields(DOC, FIELDS);
    const absent = result.candidates[1]!;
    expect(absent.valueText).toBeNull();
    expect(absent.page).toBeNull();
    expect(absent.confidence).toBe(0);
  });

  it("parseLayout: HTML tables become geometry-keyed grids; text blocks pass through", async () => {
    const adapter = new ReductoAdapter({ apiKey: "test", fetch: recordedFetch() });
    const result = await adapter.parseLayout(DOC);
    assertLayoutContract(result);
    const page = result.pages[0]!;
    expect(page.textBlocks[0]?.text).toContain("SYNTHETIC FIXTURE");
    const table = page.tables[0]!;
    expect(table.cells).toHaveLength(6); // 3 rows × 2 cols
    expect(table.cells.find((c) => c.rowIndex === 2 && c.colIndex === 1)?.text).toBe("180,000.00");
  });

  it("prices by page count in integer micro-USD", async () => {
    const adapter = new ReductoAdapter({
      apiKey: "test",
      fetch: recordedFetch(),
      costMicroUsdPerPage: 20_000n,
    });
    const result = await adapter.extractFields(DOC, FIELDS);
    expect(result.run.costMicroUsd).toBe(20_000n);
  });
});
