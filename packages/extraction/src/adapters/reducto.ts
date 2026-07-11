/**
 * Path-1 primary candidate: Reducto (M3.3, Blueprint §4.2 — strong on dense
 * financial layouts; returns bboxes + confidence per field).
 *
 * The response mapping below targets the API shape recorded in
 * fixtures/reducto-*.json (captured 2026-07). The M3.4 bake-off runs this
 * adapter against the LIVE API with [PRATIK]'s key and is the point where
 * any drift in Reducto's response shape gets caught and fixed — CI never
 * makes live calls (task M3.3).
 */

import { z } from "zod";
import {
  bboxSchema,
  fieldCandidateSchema,
  layoutPageSchema,
  type DocumentInput,
  type ExtractorAdapter,
  type FieldExtractionResult,
  type FieldRequest,
  type LayoutParseResult,
} from "../types.js";

export interface ReductoConfig {
  apiKey: string;
  baseUrl?: string;
  /** Integer micro-USD per page (Blueprint §12: ~$0.015–0.02/page). */
  costMicroUsdPerPage?: bigint;
  fetch?: typeof globalThis.fetch;
}

/** Reducto bbox: fractional page coordinates with its own page number. */
const reductoBbox = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
  page: z.number().int().min(1),
});

const parseResponseSchema = z.object({
  usage: z.object({ num_pages: z.number().int().min(1) }),
  result: z.object({
    chunks: z.array(
      z.object({
        blocks: z.array(
          z.object({
            type: z.string(), // "Text" | "Table" | "Title" | ...
            content: z.string(),
            bbox: reductoBbox,
            /** Present on Table blocks: per-cell text + geometry. */
            cells: z
              .array(
                z.object({
                  content: z.string(),
                  bbox: reductoBbox,
                  row: z.number().int().min(0),
                  col: z.number().int().min(0),
                }),
              )
              .optional(),
          }),
        ),
      }),
    ),
  }),
});

const extractResponseSchema = z.object({
  usage: z.object({ num_pages: z.number().int().min(1) }),
  result: z.array(
    z.object({
      field_id: z.string(),
      value: z.string().nullable(),
      bbox: reductoBbox.nullable(),
      confidence: z.number(),
    }),
  ),
});

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function toBbox(b: z.infer<typeof reductoBbox>) {
  return bboxSchema.parse({
    x: clamp01(b.left),
    y: clamp01(b.top),
    w: Math.min(Math.max(b.width, 1e-6), 1),
    h: Math.min(Math.max(b.height, 1e-6), 1),
  });
}

export class ReductoAdapter implements ExtractorAdapter {
  readonly name = "reducto";
  readonly version = "1";
  private cfg: Required<Pick<ReductoConfig, "apiKey">> & ReductoConfig;
  private fetchImpl: typeof globalThis.fetch;
  private perPage: bigint;

  constructor(cfg: ReductoConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetch ?? globalThis.fetch;
    this.perPage = cfg.costMicroUsdPerPage ?? 20_000n; // $0.02/page ceiling
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(
      `${this.cfg.baseUrl ?? "https://platform.reducto.ai"}${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`reducto ${path} failed (${res.status})`);
    return res.json();
  }

  async parseLayout(doc: DocumentInput): Promise<LayoutParseResult> {
    const raw = await this.post("/parse", {
      document: { base64: Buffer.from(doc.bytes).toString("base64"), mime_type: doc.mimeType },
    });
    const parsed = parseResponseSchema.parse(raw);

    const pages = new Map<number, { textBlocks: unknown[]; tables: unknown[] }>();
    const pageOf = (n: number) => {
      let p = pages.get(n);
      if (!p) {
        p = { textBlocks: [], tables: [] };
        pages.set(n, p);
      }
      return p;
    };

    for (const chunk of parsed.result.chunks) {
      for (const block of chunk.blocks) {
        const page = pageOf(block.bbox.page);
        if (block.type === "Table" && block.cells) {
          page.tables.push({
            page: block.bbox.page,
            bbox: toBbox(block.bbox),
            cells: block.cells.map((c) => ({
              text: c.content,
              bbox: toBbox(c.bbox),
              rowIndex: c.row,
              colIndex: c.col,
            })),
          });
        } else {
          page.textBlocks.push({ text: block.content, bbox: toBbox(block.bbox) });
        }
      }
    }

    return {
      pages: [...pages.entries()]
        .sort(([a], [b]) => a - b)
        .map(([page, p]) => layoutPageSchema.parse({ page, ...p })),
      run: {
        vendor: this.name,
        vendorVersion: this.version,
        pageCount: parsed.usage.num_pages,
        costMicroUsd: BigInt(parsed.usage.num_pages) * this.perPage,
      },
    };
  }

  async extractFields(doc: DocumentInput, fields: FieldRequest[]): Promise<FieldExtractionResult> {
    const raw = await this.post("/extract", {
      document: { base64: Buffer.from(doc.bytes).toString("base64"), mime_type: doc.mimeType },
      schema: fields.map((f) => ({
        field_id: f.fieldId,
        description: f.label,
        aliases: f.aliases ?? [],
        page_hint: f.pageHint ?? null,
        type: f.dtype,
      })),
    });
    const parsed = extractResponseSchema.parse(raw);
    const byId = new Map(parsed.result.map((r) => [r.field_id, r]));

    const candidates = fields.map((f) => {
      const r = byId.get(f.fieldId);
      return fieldCandidateSchema.parse({
        fieldId: f.fieldId,
        valueText: r?.value ?? null,
        page: r?.value === null || !r ? null : (r.bbox?.page ?? null),
        bbox: r?.value !== null && r?.bbox ? toBbox(r.bbox) : null,
        confidence: r ? clamp01(r.confidence) : 0,
      });
    });

    return {
      candidates,
      run: {
        vendor: this.name,
        vendorVersion: this.version,
        pageCount: parsed.usage.num_pages,
        costMicroUsd: BigInt(parsed.usage.num_pages) * this.perPage,
      },
    };
  }
}
