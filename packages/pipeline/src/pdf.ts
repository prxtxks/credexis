/**
 * Per-page text extraction from uploaded bytes (unpdf = pdf.js text layer).
 * Native PDFs yield real text; scanned pages yield empty strings and fall
 * through to the LLM classifier (and, once thumbnail rendering lands, to
 * vision). This module extracts what the file already contains - it never
 * synthesizes content (Iron Law #1 applies downstream).
 */

import { extractText, getDocumentProxy } from "unpdf";

export interface PdfText {
  pageCount: number;
  /** Index i = page i+1. */
  pageTexts: string[];
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { pageCount: totalPages, pageTexts: text };
}

/**
 * Slice a page range [pageStart..pageEnd] (1-based, inclusive) into a new
 * PDF (M3.4 finding): adapters read ONLY the logical document's pages -
 * Azure stops hallucinating 1099s from cover letters, every vendor bills
 * fewer pages, and recall rises because the signal isn't buried in a
 * 50-page bundle. Falls back to the original bytes on any slice failure
 * (a bad slice must never lose the document).
 */
export async function slicePdfPages(
  bytes: Uint8Array,
  pageStart: number,
  pageEnd: number,
): Promise<{ bytes: Uint8Array; pageCount: number; sliced: boolean }> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const total = src.getPageCount();
    const start = Math.max(1, pageStart);
    const end = Math.min(total, pageEnd);
    if (start === 1 && end === total) return { bytes, pageCount: total, sliced: false };
    if (start > end) return { bytes, pageCount: total, sliced: false };
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    const pages = await out.copyPages(src, indices);
    for (const page of pages) out.addPage(page);
    return { bytes: await out.save(), pageCount: end - start + 1, sliced: true };
  } catch {
    return { bytes, pageCount: pageEnd - pageStart + 1, sliced: false };
  }
}
