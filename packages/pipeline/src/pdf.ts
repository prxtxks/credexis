/**
 * Per-page text extraction from uploaded bytes (unpdf = pdf.js text layer).
 * Native PDFs yield real text; scanned pages yield empty strings and fall
 * through to the LLM classifier (and, once thumbnail rendering lands, to
 * vision). This module extracts what the file already contains — it never
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
