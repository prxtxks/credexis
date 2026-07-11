/**
 * Thin PDF I/O for corpus intake: hashing, page count, per-page text
 * extraction (for the redaction scan). Extraction quality here only needs to
 * be good enough to FIND PII-shaped strings — it is not the product pipeline.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";
import type { PdfInfo } from "./intake.js";

export interface LoadedPdf extends PdfInfo {
  /** Text of each page; index i = page i+1. */
  pageTexts: string[];
}

export async function loadPdf(path: string): Promise<LoadedPdf> {
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { sha256, bytes: bytes.byteLength, pageCount: totalPages, pageTexts: text };
}
