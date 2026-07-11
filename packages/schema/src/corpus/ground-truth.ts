/**
 * Golden-corpus ground-truth format (M1.1, Blueprint §9).
 *
 * One JSON document per corpus PDF: what every field on that document truly
 * says, labeled by a human. This is the spec the extraction pipeline is graded
 * against (Iron Law #9: ground truth is never edited to make an eval pass).
 *
 * Conventions
 * - Money is integer cents. JSON cannot carry bigint, so `value_cents` is a
 *   string of digits (e.g. "-1250000" = −$12,500.00) transformed to bigint on
 *   parse (Iron Law #2). `value_cents: null` means the field is genuinely
 *   blank/absent on this document — the extractor is correct to return null
 *   (null-vs-zero disambiguation, Blueprint §4.4).
 * - Bounding boxes are normalized to [0,1] with origin at the page's top-left
 *   (vendor-agnostic; every adapter converts into this space).
 * - `synthetic: true` marks programmatically generated fixtures (M1.5). The
 *   eval harness must NEVER count synthetic documents in accuracy claims
 *   (Iron Law #9); the flag lives here so that rule is enforceable in code.
 */

import { z } from "zod";

/** String-encoded integer cents ⇄ bigint. */
export const centsString = z
  .string()
  .regex(/^-?\d+$/, 'value_cents must be a string of digits, e.g. "-1250000"')
  .transform((s) => BigInt(s));

/** Normalized bbox, origin top-left, all values in [0,1]. */
export const bboxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
  })
  .refine((b) => b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9, {
    message: "bbox must lie inside the page (x+w ≤ 1 and y+h ≤ 1)",
  });

/** MVP form families (frozen list — Blueprint §1). Statements have no form. */
export const formFamilySchema = z.enum([
  "1120",
  "1120S",
  "1065",
  "1040",
  "1040_SCH_1",
  "1040_SCH_C",
  "1040_SCH_E",
  "1040_SCH_F",
  "K1_1120S",
  "K1_1065",
  "4562",
  "8825",
  "1125E",
  "W2",
  "PNL",
  "BALANCE_SHEET",
  "DEBT_SCHEDULE",
]);

/** Scan quality axis of the corpus matrix (Blueprint §9). */
export const docQualitySchema = z.enum(["native", "scanned", "skewed"]);

/** Which deal entity the document belongs to. */
export const entityKindSchema = z.enum(["applicant", "target", "guarantor", "spouse", "epc", "oc"]);

/**
 * One labeled field. Exactly one of `registry_field_id` (tax forms — resolves
 * against the Form Registry, M4.1) or `taxonomy_node` (statements — resolves
 * against the canonical taxonomy, M2.6) identifies what the field IS.
 */
export const groundTruthFieldSchema = z
  .object({
    registry_field_id: z.string().min(1).optional(),
    taxonomy_node: z.string().min(1).optional(),
    /** Canonical period label, e.g. "FY2024", "2025-01..2025-06", "TTM2025-06". */
    period: z.string().min(1),
    value_cents: centsString.nullable(),
    /** 1-based page number within THIS document's PDF. */
    page: z.number().int().min(1),
    bbox: bboxSchema.optional(),
    /** Free-form labeler note (illegible, handwritten, ambiguous, …). */
    note: z.string().optional(),
  })
  .refine((f) => (f.registry_field_id === undefined) !== (f.taxonomy_node === undefined), {
    message: "exactly one of registry_field_id or taxonomy_node is required",
  });

/** Ground truth for one corpus document. */
export const groundTruthDocumentSchema = z.object({
  /** Stable corpus id, e.g. "1120s-2023-native-001". */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id must be kebab-case"),
  form_family: formFamilySchema,
  /** Tax year for IRS forms; null for statements (period lives per field). */
  tax_year: z.number().int().min(2015).max(2035).nullable(),
  entity: entityKindSchema,
  quality: docQualitySchema,
  /** True for programmatically generated fixtures — never counted in accuracy. */
  synthetic: z.boolean(),
  /** SHA-256 of the exact PDF this labels (binds label ⇄ file immutably). */
  pdf_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  page_count: z.number().int().min(1),
  /** Who labeled it and when (audit trail for the spec itself). */
  labeled_by: z.string().min(1),
  labeled_at: z.string().datetime(),
  fields: z.array(groundTruthFieldSchema).min(1),
});

/**
 * corpus/manifest.json — the index of the whole corpus. PDFs themselves live
 * in a private bucket (or locally under corpus/pdfs/, gitignored) — NEVER in
 * git; the manifest carries their hashes so any copy is verifiable.
 */
export const corpusManifestEntrySchema = z.object({
  id: z.string(),
  ground_truth_path: z.string(),
  pdf_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pdf_bytes: z.number().int().min(1),
  /** Bucket object key once uploaded (M0.5 provisioning); null until then. */
  pdf_bucket_key: z.string().nullable(),
});

export const corpusManifestSchema = z.object({
  version: z.literal(1),
  updated_at: z.string().datetime(),
  documents: z.array(corpusManifestEntrySchema),
});

export type GroundTruthField = z.infer<typeof groundTruthFieldSchema>;
export type GroundTruthDocument = z.infer<typeof groundTruthDocumentSchema>;
export type CorpusManifest = z.infer<typeof corpusManifestSchema>;
export type CorpusManifestEntry = z.infer<typeof corpusManifestEntrySchema>;
export type FormFamily = z.infer<typeof formFamilySchema>;
export type DocQuality = z.infer<typeof docQualitySchema>;
export type EntityKind = z.infer<typeof entityKindSchema>;
