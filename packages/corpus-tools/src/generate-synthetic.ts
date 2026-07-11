/**
 * `corpus generate-synthetic` (M1.5): writes the 10 fixture PDFs into
 * corpus/synthetic/ (gitignored) and their zod-validated ground truths +
 * manifest entries. Deterministic — regenerating yields identical bytes, so
 * committed ground truths stay hash-bound to regenerable PDFs.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  corpusManifestSchema,
  groundTruthDocumentSchema,
  type EntityKind,
  type FormFamily,
} from "@credexis/schema";
import { groundTruthPath, upsertManifestEntry } from "./intake.js";
import { buildSyntheticPdf, SYNTHETIC_SPECS } from "./synthetic.js";

/** Fixed label timestamp — synthetic truth is generated, not hand-labeled. */
const LABELED_AT = "2026-07-11T00:00:00Z";

function entityFor(form: FormFamily): EntityKind {
  return form === "1040" || form === "W2" ? "guarantor" : "applicant";
}

export async function generateSynthetic(corpusDir: string): Promise<string[]> {
  await mkdir(join(corpusDir, "synthetic"), { recursive: true });
  await mkdir(join(corpusDir, "ground-truth"), { recursive: true });

  const manifestPath = join(corpusDir, "manifest.json");
  let manifest = corpusManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));

  const written: string[] = [];
  for (const spec of SYNTHETIC_SPECS) {
    const { pdf, fields, pageCount } = await buildSyntheticPdf(spec);
    const sha256 = createHash("sha256").update(pdf).digest("hex");

    const gtJson = {
      id: spec.id,
      form_family: spec.form_family,
      tax_year: spec.tax_year,
      entity: entityFor(spec.form_family),
      quality: "native",
      synthetic: true,
      pdf_sha256: sha256,
      page_count: pageCount,
      labeled_by: "synthetic-generator",
      labeled_at: LABELED_AT,
      fields,
    };
    // Validate before writing — the generator obeys the same schema as humans.
    groundTruthDocumentSchema.parse(gtJson);

    const pdfPath = join(corpusDir, "synthetic", `${spec.id}.pdf`);
    await writeFile(pdfPath, pdf);
    await writeFile(
      join(corpusDir, groundTruthPath(spec.id)),
      JSON.stringify(gtJson, null, 2) + "\n",
      "utf8",
    );
    manifest = upsertManifestEntry(
      manifest,
      {
        id: spec.id,
        ground_truth_path: groundTruthPath(spec.id),
        pdf_sha256: sha256,
        pdf_bytes: pdf.byteLength,
        pdf_bucket_key: null,
      },
      { updatedAt: new Date().toISOString(), force: true },
    );
    written.push(spec.id);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return written;
}
