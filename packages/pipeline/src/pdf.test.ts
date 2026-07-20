import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractPdfText, slicePdfPages } from "./pdf.js";

async function fivePager(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 5; i++) doc.addPage([200, 200]);
  return doc.save();
}

describe("slicePdfPages (M3.4 bake-off finding)", () => {
  it("slices an inclusive 1-based range", async () => {
    const sliced = await slicePdfPages(await fivePager(), 2, 4);
    expect(sliced.sliced).toBe(true);
    expect(sliced.pageCount).toBe(3);
    const roundTrip = await PDFDocument.load(sliced.bytes);
    expect(roundTrip.getPageCount()).toBe(3);
  });

  it("full-range and out-of-range requests return the original bytes", async () => {
    const bytes = await fivePager();
    expect((await slicePdfPages(bytes, 1, 5)).sliced).toBe(false);
    expect((await slicePdfPages(bytes, 1, 99)).pageCount).toBe(5);
    expect((await slicePdfPages(bytes, 9, 4)).sliced).toBe(false);
  });

  it("garbage bytes fall back to the original (never lose the document)", async () => {
    const garbage = new TextEncoder().encode("not a pdf");
    const out = await slicePdfPages(garbage, 1, 2);
    expect(out.sliced).toBe(false);
    expect(out.bytes).toBe(garbage);
  });
});

describe("extractPdfText", () => {
  it("still reads page text (regression guard for the shared module)", async () => {
    const { pageCount } = await extractPdfText(await fivePager());
    expect(pageCount).toBe(5);
  });
});
