/**
 * ExtractorAdapter contract (M3.3, Blueprint §4.2/§4.3/§10).
 *
 * Every vendor sits behind this interface — swapping vendors is a config
 * change, not a rewrite. The contract encodes the iron laws at the type
 * level:
 *
 * - `valueText` is the RAW text the vendor read — never normalized, never
 *   parsed. The number normalizer (@credexis/shared, M3.6) is the only
 *   place text becomes cents, downstream of every adapter.
 * - Bounding boxes are normalized to [0,1], origin top-left — the same
 *   convention as the corpus ground truth. Adapters convert vendor
 *   coordinate spaces into this one.
 * - A field the vendor cannot find/read is `valueText: null` with low/zero
 *   confidence — never a guess (Iron Law #1).
 * - Every result carries cost accounting (standing order #9): integer
 *   micro-USD, bigint, no floats near money.
 */

import { z } from "zod";

/** Normalized bbox, origin top-left, all values in [0,1]. */
export const bboxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
  })
  .refine((b) => b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9, {
    message: "bbox must lie inside the page",
  });
export type Bbox = z.infer<typeof bboxSchema>;

/** The document bytes an adapter works on. */
export interface DocumentInput {
  bytes: Uint8Array;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/tiff";
  /** For logging/cost accounting; adapters must not trust it for parsing. */
  pageCount?: number;
}

/** One field the caller wants extracted (registry-derived in M4.2/M4.3). */
export interface FieldRequest {
  /** Registry field id, e.g. "f1120s.line21". */
  fieldId: string;
  /** Human label + aliases the field appears under on the form. */
  label: string;
  aliases?: string[];
  /** 1-based page hint from the registry (advisory only). */
  pageHint?: number;
  /** Registry location guidance relayed to the vendor (never a value). */
  hint?: string;
  dtype: "money" | "integer" | "percent" | "text" | "date";
  /** Money fields on IRS forms may have a separate cents box. */
  hasCentsBox?: boolean;
}

/** One extracted candidate. RAW text — normalization happens downstream. */
export const fieldCandidateSchema = z.object({
  fieldId: z.string().min(1),
  /** Exactly what the vendor read; null = present-but-blank or not found. */
  valueText: z.string().nullable(),
  /** Cents-box companion text when the field has one (raw, unparsed). */
  centsBoxText: z.string().nullable().optional(),
  /** 1-based page the value was found on; null when valueText is null. */
  page: z.number().int().min(1).nullable(),
  bbox: bboxSchema.nullable(),
  /** Vendor-reported or model-derived confidence, 0..1. */
  confidence: z.number().min(0).max(1),
});
export type FieldCandidate = z.infer<typeof fieldCandidateSchema>;

/** Layout parse output: cells with geometry (Blueprint §4.3 stage 1). */
export const layoutCellSchema = z.object({
  text: z.string(),
  bbox: bboxSchema,
  /** Row/column identity within the table — geometry, not ordinal guessing. */
  rowIndex: z.number().int().min(0),
  colIndex: z.number().int().min(0),
});
export type LayoutCell = z.infer<typeof layoutCellSchema>;

export const layoutTableSchema = z.object({
  page: z.number().int().min(1),
  bbox: bboxSchema,
  cells: z.array(layoutCellSchema),
});
export type LayoutTable = z.infer<typeof layoutTableSchema>;

export const layoutPageSchema = z.object({
  page: z.number().int().min(1),
  /** Free text lines outside tables (headers, footnotes) with geometry. */
  textBlocks: z.array(z.object({ text: z.string(), bbox: bboxSchema })),
  tables: z.array(layoutTableSchema),
});
export type LayoutPage = z.infer<typeof layoutPageSchema>;

/** Cost + provenance accounting attached to every adapter result. */
export interface AdapterRunInfo {
  vendor: string;
  vendorVersion: string;
  /** Model id / API version actually used. */
  model?: string;
  pageCount: number;
  /** Integer micro-USD (bigint — Iron Law #2 discipline for cost money). */
  costMicroUsd: bigint;
}

export interface LayoutParseResult {
  pages: LayoutPage[];
  run: AdapterRunInfo;
}

export interface FieldExtractionResult {
  candidates: FieldCandidate[];
  run: AdapterRunInfo;
}

/**
 * The seam. Implementations: ReductoAdapter, AzureDocumentIntelligenceAdapter,
 * AnthropicVisionAdapter. Contract tests in src/contract/ run against every
 * implementation with recorded vendor responses (no live calls in CI).
 */
export interface ExtractorAdapter {
  readonly name: string;
  readonly version: string;
  /** Page → tables/cells with geometry. Statements path (M5.1). */
  parseLayout(doc: DocumentInput): Promise<LayoutParseResult>;
  /** Schema-driven field extraction. Tax-form path (M4.2/M4.3). */
  extractFields(doc: DocumentInput, fields: FieldRequest[]): Promise<FieldExtractionResult>;
}
