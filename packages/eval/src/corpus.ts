/**
 * Corpus loading for the eval harness: manifest → ground-truth docs, with the
 * PDF attached when it exists locally (PDFs are gitignored and may be absent,
 * e.g. in CI — mock extractors don't need them).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { corpusManifestSchema, groundTruthDocumentSchema } from "@credexis/schema";
import type { EvalDocument } from "./types.js";

export async function loadCorpus(corpusDir: string): Promise<EvalDocument[]> {
  const manifest = corpusManifestSchema.parse(
    JSON.parse(await readFile(join(corpusDir, "manifest.json"), "utf8")),
  );
  const docs: EvalDocument[] = [];
  for (const entry of manifest.documents) {
    const gt = groundTruthDocumentSchema.parse(
      JSON.parse(await readFile(join(corpusDir, entry.ground_truth_path), "utf8")),
    );
    if (gt.pdf_sha256 !== entry.pdf_sha256) {
      throw new Error(
        `corpus integrity: manifest and ground truth disagree on pdf_sha256 for "${entry.id}"`,
      );
    }
    const pdfPath = join(corpusDir, "pdfs", `${entry.id}.pdf`);
    docs.push({ groundTruth: gt, pdfPath: existsSync(pdfPath) ? pdfPath : null });
  }
  return docs;
}
