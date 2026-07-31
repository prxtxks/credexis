/**
 * Per-page text extraction and rendering from uploaded bytes (unpdf =
 * pdf.js). Native PDFs yield real text; SCANNED pages yield empty strings
 * and are rendered to PNG so the vision classifier can read them. This
 * module extracts what the file already contains - it never synthesizes
 * content (Iron Law #1 applies downstream).
 */

import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";

export interface PdfText {
  pageCount: number;
  /** Index i = page i+1. */
  pageTexts: string[];
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  // COPY: pdf.js TRANSFERS the buffer into its worker, which detaches the
  // caller's view - `bytes.byteLength` becomes 0 and every later consumer
  // silently sees an empty file. That is how scanned-page rendering came
  // back empty for a whole 19-page bundle (M13.6). Callers hand us bytes
  // they still need; reading them must not consume them.
  const pdf = await getDocumentProxy(bytes.slice());
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

/* ── scanned pages: render for the vision classifier (M13.6) ─────────── */

/**
 * A page carrying fewer than this many characters is treated as having no
 * usable text layer. Not zero: scanners and "print to PDF" often leave a
 * few stray glyphs (a page number, a fax banner) that are useless for
 * classification but non-empty.
 */
export const MIN_TEXT_CHARS = 40;

/** Rendered wide enough for form numbers to survive, small enough that a
 *  19-page scan is not a fortune in vision tokens. Letter at 1.5 ≈ 918px. */
const RENDER_SCALE = 1.5;

/** Never ship a page image larger than the API will take comfortably. */
const MAX_IMAGE_BYTES = 4_000_000;

export function pagesNeedingRender(pageTexts: readonly string[]): number[] {
  return pageTexts
    .map((t, i) => ({ page: i + 1, len: t.trim().length }))
    .filter((p) => p.len < MIN_TEXT_CHARS)
    .map((p) => p.page);
}

/**
 * Render the given 1-based pages to PNG. Best-effort per page: a page that
 * fails to render is simply absent from the map, because a broken raster
 * must degrade to "unresolved, send to review" - never fail the ingest of
 * a document whose other pages are fine.
 *
 * The canvas backend is imported lazily so environments that never render
 * (tests, text-only bundles) do not pay for loading it.
 */
export async function renderPageImages(
  bytes: Uint8Array,
  pages: readonly number[],
  onError?: (page: number, message: string) => void,
): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  for (const page of pages) {
    try {
      // A FRESH COPY per page: pdf.js TRANSFERS the buffer into its worker,
      // which detaches it, so every call after the first sees a dead
      // buffer and dies with "Cannot transfer object of unsupported type".
      // Rendering silently produced nothing for pages 2..n until this was
      // caught against the real 19-page scan.
      const png = await renderPageAsImage(bytes.slice(), page, {
        scale: RENDER_SCALE,
        canvasImport: () => import("@napi-rs/canvas") as never,
      });
      const buf = new Uint8Array(png);
      if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
        onError?.(page, `render produced ${buf.byteLength} bytes (outside limits)`);
        continue;
      }
      out.set(page, buf);
    } catch (e) {
      // A page that will not render degrades to text-only → unresolved →
      // review. Never silent: a whole bundle failing to render is exactly
      // the kind of thing that must show up in the run log.
      onError?.(page, (e as Error).message.slice(0, 200));
    }
  }
  return out;
}
