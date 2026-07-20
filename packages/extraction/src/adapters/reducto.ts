/**
 * Path-1 primary candidate: Reducto (M3.3/M3.4, Blueprint §4.2).
 *
 * ✅ VERIFIED AGAINST THE LIVE API 2026-07-18 (synthetic 1120-S with
 * planted values; both endpoints returned the shapes mapped below):
 *
 *   1. POST /upload (multipart)              → { file_id: "reducto://…" }
 *   2. POST /parse  { document_url }         → { result.chunks[].blocks[],
 *                                                usage.num_pages }
 *      blocks: { type: "Text"|"Table", bbox: {left,top,width,height,page}
 *      normalized 0..1, content } — Table content is an HTML <table> whose
 *      tr/td structure IS the vendor's cell identity (a blank <td> holds
 *      its position, so columns cannot shift — post-mortem trap 1).
 *      Per-cell bboxes are not in the default parse; cells carry their
 *      table's bbox (region-level lineage; refinement is a bake-off item).
 *   3. POST /extract { document_url, schema, generate_citations: true }
 *      → { result: [{key: raw text}], citations: [{key: [{bbox, page,
 *      granular_confidence.parse_confidence}]}] } — per-field bbox +
 *      confidence, exactly the Path-1 lineage the blueprint requires.
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

/** Reducto bbox: fractional page coordinates (verified normalized 0..1). */
const reductoBbox = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
  page: z.number().int().min(1),
});

const uploadResponseSchema = z.object({ file_id: z.string().min(1) });

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
          }),
        ),
      }),
    ),
  }),
});

const citationEntrySchema = z.object({
  bbox: reductoBbox,
  granular_confidence: z.object({ parse_confidence: z.number().nullable() }).partial().optional(),
  confidence: z.string().optional(), // "high" | "medium" | "low"
});

const extractResponseSchema = z.object({
  usage: z.object({ num_pages: z.number().int().min(1) }),
  result: z.array(z.record(z.string().nullable())),
  citations: z.array(z.record(z.array(citationEntrySchema))).nullable(),
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

/** Verbal confidence → numeric when the granular number is absent. */
const CONFIDENCE_WORDS: Record<string, number> = { high: 0.9, medium: 0.7, low: 0.4 };

/** JSON-schema keys can't be trusted with dots — sanitize + map back. */
const keyFor = (fieldId: string) => fieldId.replace(/[^a-zA-Z0-9_]/g, "__");

/**
 * Parse the vendor's HTML table into rows of cell strings. The tr/td
 * structure is the VENDOR's table model — cell position within it is
 * column identity, not ordinal guessing. Vendor-emitted HTML only.
 */
export function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
      cells.push(
        cellMatch[1]!
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim(),
      );
    }
    rows.push(cells);
  }
  return rows;
}

export class ReductoAdapter implements ExtractorAdapter {
  readonly name = "reducto";
  readonly version = "2"; // v2: live-verified API shapes (2026-07-18)
  private cfg: ReductoConfig;
  private fetchImpl: typeof globalThis.fetch;
  private perPage: bigint;

  constructor(cfg: ReductoConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetch ?? globalThis.fetch;
    this.perPage = cfg.costMicroUsdPerPage ?? 20_000n; // $0.02/page ceiling
  }

  private base(): string {
    return this.cfg.baseUrl ?? "https://platform.reducto.ai";
  }

  /** Step 1 of every call: multipart upload → reducto:// file id. */
  private async upload(doc: DocumentInput): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(doc.bytes)], { type: doc.mimeType }), "document.pdf");
    const res = await this.fetchImpl(`${this.base()}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`reducto /upload failed (${res.status})`);
    return uploadResponseSchema.parse(await res.json()).file_id;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`reducto ${path} failed (${res.status}): ${detail}`);
    }
    return res.json();
  }

  async parseLayout(doc: DocumentInput): Promise<LayoutParseResult> {
    const fileId = await this.upload(doc);
    const parsed = parseResponseSchema.parse(await this.post("/parse", { document_url: fileId }));

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
        if (block.type === "Table") {
          const tableBbox = toBbox(block.bbox);
          const rows = parseHtmlTable(block.content);
          page.tables.push({
            page: block.bbox.page,
            bbox: tableBbox,
            cells: rows.flatMap((cells, rowIndex) =>
              cells.map((text, colIndex) => ({
                text,
                // Default parse has no per-cell geometry: the table's bbox
                // is the honest region-level lineage (refined at bake-off).
                bbox: tableBbox,
                rowIndex,
                colIndex,
              })),
            ),
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
    const fileId = await this.upload(doc);

    const properties: Record<string, unknown> = {};
    for (const f of fields) {
      const aliases = f.aliases?.length ? ` (also labeled: ${f.aliases.join("; ")})` : "";
      const hint = f.hint ? ` NOTE: ${f.hint}` : "";
      properties[keyFor(f.fieldId)] = {
        type: "string",
        description:
          `Line ${f.label}${aliases}. Return the EXACT raw text as printed ` +
          `(keep commas/parentheses/symbols). Empty string if absent or illegible.${hint}`,
      };
    }

    const raw = await this.post("/extract", {
      document_url: fileId,
      schema: {
        type: "object",
        properties,
        required: Object.keys(properties),
      },
      generate_citations: true,
    });
    const parsed = extractResponseSchema.parse(raw);
    const values = parsed.result[0] ?? {};
    const cites = parsed.citations?.[0] ?? {};

    const candidates = fields.map((f) => {
      const key = keyFor(f.fieldId);
      const rawText = values[key] ?? null;
      const valueText = rawText === null || rawText.trim() === "" ? null : rawText;
      const cite = cites[key]?.[0];
      const numeric = cite?.granular_confidence?.parse_confidence;
      const confidence =
        valueText === null
          ? 0
          : clamp01(numeric ?? CONFIDENCE_WORDS[cite?.confidence ?? ""] ?? 0.5);
      return fieldCandidateSchema.parse({
        fieldId: f.fieldId,
        valueText,
        page: valueText === null ? null : (cite?.bbox.page ?? null),
        bbox: valueText !== null && cite ? toBbox(cite.bbox) : null,
        confidence,
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
