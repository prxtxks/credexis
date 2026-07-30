/**
 * Downloads the signal-sweep corpus (public IRS PDFs) into
 * corpus/signal-sweep/. Idempotent: existing non-empty files are kept, so
 * re-runs only fetch what is missing. No auth, no PII - these are the
 * IRS's own published documents.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SWEEP_MANIFEST } from "./manifest.js";

export interface DownloadResult {
  id: string;
  status: "downloaded" | "cached" | "failed";
  bytes?: number;
  error?: string;
}

async function fileBytes(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.size > 0 ? s.size : null;
  } catch {
    return null;
  }
}

export async function downloadSweepCorpus(dir: string): Promise<DownloadResult[]> {
  await mkdir(dir, { recursive: true });
  const results: DownloadResult[] = [];
  for (const doc of SWEEP_MANIFEST) {
    const path = join(dir, `${doc.id}.pdf`);
    const cached = await fileBytes(path);
    if (cached !== null) {
      results.push({ id: doc.id, status: "cached", bytes: cached });
      continue;
    }
    try {
      const res = await fetch(doc.url);
      if (!res.ok) {
        results.push({ id: doc.id, status: "failed", error: `HTTP ${res.status}` });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // An HTML error page saved as .pdf poisons the sweep - check magic.
      if (!buf.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
        results.push({ id: doc.id, status: "failed", error: "not a PDF (magic mismatch)" });
        continue;
      }
      await writeFile(path, buf);
      results.push({ id: doc.id, status: "downloaded", bytes: buf.byteLength });
    } catch (e) {
      results.push({
        id: doc.id,
        status: "failed",
        error: e instanceof Error ? e.message : `${e}`,
      });
    }
  }
  return results;
}
