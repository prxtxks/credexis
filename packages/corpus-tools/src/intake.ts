/**
 * Corpus intake logic (M1.2) — pure functions; the CLI is a thin shell.
 * Flow: `corpus template` emits a YAML skeleton for a PDF → the labeler fills
 * it → `corpus add` validates it (zod, hash binding, redaction scan + manual
 * confirm) and writes ground-truth JSON + a manifest update.
 */

import {
  corpusManifestSchema,
  groundTruthDocumentSchema,
  type CorpusManifest,
  type CorpusManifestEntry,
} from "@credexis/schema";
import { parse as parseYaml } from "yaml";

export interface PdfInfo {
  sha256: string;
  bytes: number;
  pageCount: number;
}

/** Emit the YAML ground-truth template a labeler fills in for one PDF. */
export function renderYamlTemplate(id: string, pdfFileName: string, pdf: PdfInfo): string {
  return `# Ground-truth template for ${pdfFileName}
# Fill every field the document actually shows. Rules:
# - value_cents: INTEGER CENTS as a quoted string ("1250000" = $12,500.00;
#   negatives "-500"). Use null when the box is genuinely blank on the form.
# - Exactly ONE of registry_field_id (tax forms) or taxonomy_node (statements)
#   per field.
# - bbox is optional but valuable: normalized 0..1, origin top-left.
# - NEVER adjust values later to make an eval pass (Iron Law #9).
id: ${id}
form_family: # one of 1120 | 1120S | 1065 | 1040 | 1040_SCH_1 | 1040_SCH_C | 1040_SCH_E | 1040_SCH_F | K1_1120S | K1_1065 | 4562 | 8825 | 1125E | W2 | PNL | BALANCE_SHEET | DEBT_SCHEDULE
tax_year: # e.g. 2023, or null for statements
entity: # applicant | target | guarantor | spouse | epc | oc
quality: # native | scanned | skewed
synthetic: false
pdf_sha256: ${pdf.sha256}
page_count: ${pdf.pageCount}
labeled_by: # your name
labeled_at: # ISO timestamp, e.g. 2026-07-11T12:00:00Z
fields:
  - registry_field_id: # e.g. f1120s.line1a  (or use taxonomy_node: instead)
    period: # e.g. FY2023
    value_cents: "0"
    page: 1
    # bbox: { x: 0.0, y: 0.0, w: 0.1, h: 0.02 }
`;
}

/**
 * Parse + validate a filled YAML template into a ground-truth document.
 * Returns the validated document (bigint cents) and its JSON-serializable
 * form (digit-string cents) for writing to disk.
 */
export function parseFilledTemplate(yamlText: string): {
  document: ReturnType<typeof groundTruthDocumentSchema.parse>;
  json: unknown;
} {
  const raw: unknown = parseYaml(yamlText);
  // Validate strictly; zod transforms value_cents strings → bigint.
  const document = groundTruthDocumentSchema.parse(raw);
  // The raw (pre-transform) shape IS the JSON on-disk form — re-serialize it
  // after validation so what we write is exactly what was proven valid.
  return { document, json: raw };
}

/** Ground-truth JSON path (relative to corpus/) for a document id. */
export function groundTruthPath(id: string): string {
  return `ground-truth/${id}.json`;
}

/**
 * Insert-or-replace a manifest entry; entries stay sorted by id. Replacing an
 * entry whose pdf_sha256 changed throws — labels bind to exact bytes; a new
 * scan of the "same" document must be re-verified deliberately (--force).
 */
export function upsertManifestEntry(
  manifest: CorpusManifest,
  entry: CorpusManifestEntry,
  opts: { updatedAt: string; force?: boolean },
): CorpusManifest {
  const existing = manifest.documents.find((d) => d.id === entry.id);
  if (existing && existing.pdf_sha256 !== entry.pdf_sha256 && !opts.force) {
    throw new Error(
      `manifest entry "${entry.id}" exists with a different pdf_sha256 — ` +
        `labels bind to exact PDF bytes. Re-verify the labels, then pass --force.`,
    );
  }
  const documents = [...manifest.documents.filter((d) => d.id !== entry.id), entry].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return corpusManifestSchema.parse({ version: 1, updated_at: opts.updatedAt, documents });
}
