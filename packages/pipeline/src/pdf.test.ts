import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractPdfText, MIN_TEXT_CHARS, pagesNeedingRender, slicePdfPages } from "./pdf.js";

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

describe("pagesNeedingRender (M13.6 - scanned pages reach the vision reader)", () => {
  it("selects pages with no usable text layer", () => {
    // The real customer bundle: 19 image-only pages, 0 chars each.
    expect(pagesNeedingRender(["", "", ""])).toEqual([1, 2, 3]);
  });

  it("ignores pages that carry real text", () => {
    const realPage = "Form 1120 U.S. Corporation Income Tax Return OMB No. 1545-0123 2023";
    expect(pagesNeedingRender([realPage, "", realPage])).toEqual([2]);
  });

  it("treats scanner litter as no text - a page number is not a text layer", () => {
    expect(pagesNeedingRender(["  3  ", "Page 2 of 19"])).toEqual([1, 2]);
  });

  it("renders nothing for a fully native bundle", () => {
    const page = "x".repeat(MIN_TEXT_CHARS);
    expect(pagesNeedingRender([page, page])).toEqual([]);
  });
});

describe("buffer safety (M13.6)", () => {
  it("extractPdfText does NOT consume the caller's bytes", async () => {
    // pdf.js transfers its input into a worker, detaching it. Every later
    // consumer - page rendering, slicing, hashing - would then see an
    // empty file, which is exactly how scanned-page rendering silently
    // produced nothing for an entire bundle.
    const bytes = await fivePager();
    const before = bytes.byteLength;
    await extractPdfText(bytes);
    expect(bytes.byteLength, "buffer was detached by extractPdfText").toBe(before);
  });

  it("a second read of the same buffer still works", async () => {
    const bytes = await fivePager();
    const first = await extractPdfText(bytes);
    const second = await extractPdfText(bytes);
    expect(second.pageCount).toBe(first.pageCount);
  });
});
