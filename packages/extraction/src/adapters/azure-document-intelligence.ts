/**
 * Path-1 for the 1040 family: Azure Document Intelligence prebuilt US tax
 * models (M3.3, Blueprint §4.2 — cheap, deterministic, battle-tested for
 * 1040/W-2/1099; business returns are NOT covered → Reducto).
 *
 * Analyze is async: POST :analyze → 202 + Operation-Location → poll GET.
 * Coordinates arrive as inch-unit polygons; normalized here against page
 * dimensions into the [0,1] top-left space every adapter shares.
 *
 * Response mapping targets api-version 2024-11-30 shapes recorded in
 * fixtures/azure-*.json; the M3.4 bake-off validates against the live API.
 */

import { z } from "zod";
import {
  bboxSchema,
  fieldCandidateSchema,
  layoutPageSchema,
  type Bbox,
  type DocumentInput,
  type ExtractorAdapter,
  type FieldExtractionResult,
  type FieldRequest,
  type LayoutParseResult,
} from "../types.js";

export interface AzureDocIntelConfig {
  endpoint: string; // https://<resource>.cognitiveservices.azure.com
  apiKey: string;
  apiVersion?: string;
  layoutModel?: string;
  taxModel?: string;
  /** Integer micro-USD per page. */
  costMicroUsdPerPage?: bigint;
  fetch?: typeof globalThis.fetch;
  /** Poll interval ms (tests pass 0). */
  pollIntervalMs?: number;
}

const polygonPoint = z.number();
const region = z.object({
  pageNumber: z.number().int().min(1),
  polygon: z.array(polygonPoint).min(8), // 4 points, x/y interleaved
});

const analyzeResultSchema = z.object({
  status: z.enum(["notStarted", "running", "succeeded", "failed"]),
  analyzeResult: z
    .object({
      pages: z.array(
        z.object({
          pageNumber: z.number().int().min(1),
          width: z.number().positive(),
          height: z.number().positive(),
          lines: z
            .array(z.object({ content: z.string(), polygon: z.array(polygonPoint).min(8) }))
            .optional(),
        }),
      ),
      tables: z
        .array(
          z.object({
            boundingRegions: z.array(region).min(1),
            cells: z.array(
              z.object({
                rowIndex: z.number().int().min(0),
                columnIndex: z.number().int().min(0),
                content: z.string(),
                boundingRegions: z.array(region).min(1),
              }),
            ),
          }),
        )
        .optional(),
      documents: z
        .array(
          z.object({
            fields: z.record(
              z.object({
                content: z.string().optional(),
                valueString: z.string().optional(),
                confidence: z.number().optional(),
                boundingRegions: z.array(region).optional(),
              }),
            ),
          }),
        )
        .optional(),
    })
    .optional(),
});

type PageDims = Map<number, { width: number; height: number }>;

function polygonToBbox(polygon: number[], page: number, dims: PageDims): Bbox {
  const d = dims.get(page);
  if (!d) throw new Error(`azure-di: no dimensions for page ${page}`);
  const xs = polygon.filter((_, i) => i % 2 === 0).map((v) => v / d.width);
  const ys = polygon.filter((_, i) => i % 2 === 1).map((v) => v / d.height);
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp(Math.min(...xs));
  const y = clamp(Math.min(...ys));
  return bboxSchema.parse({
    x,
    y,
    w: Math.max(clamp(Math.max(...xs)) - x, 1e-6),
    h: Math.max(clamp(Math.max(...ys)) - y, 1e-6),
  });
}

export class AzureDocumentIntelligenceAdapter implements ExtractorAdapter {
  readonly name = "azure-document-intelligence";
  readonly version = "1";
  private cfg: AzureDocIntelConfig;
  private fetchImpl: typeof globalThis.fetch;
  private perPage: bigint;

  constructor(cfg: AzureDocIntelConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetch ?? globalThis.fetch;
    this.perPage = cfg.costMicroUsdPerPage ?? 10_000n; // $0.01/page [PRATIK] verify
  }

  private async analyze(
    model: string,
    doc: DocumentInput,
  ): Promise<z.infer<typeof analyzeResultSchema>> {
    const version = this.cfg.apiVersion ?? "2024-11-30";
    const submit = await this.fetchImpl(
      `${this.cfg.endpoint}/documentintelligence/documentModels/${model}:analyze?api-version=${version}`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.cfg.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ base64Source: Buffer.from(doc.bytes).toString("base64") }),
      },
    );
    if (submit.status !== 202) throw new Error(`azure-di analyze failed (${submit.status})`);
    const operationUrl = submit.headers.get("operation-location");
    if (!operationUrl) throw new Error("azure-di: missing operation-location header");

    for (let attempt = 0; attempt < 60; attempt++) {
      const poll = await this.fetchImpl(operationUrl, {
        headers: { "Ocp-Apim-Subscription-Key": this.cfg.apiKey },
      });
      if (!poll.ok) throw new Error(`azure-di poll failed (${poll.status})`);
      const body = analyzeResultSchema.parse(await poll.json());
      if (body.status === "succeeded") return body;
      if (body.status === "failed") throw new Error("azure-di: analysis failed");
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs ?? 1000));
    }
    throw new Error("azure-di: polling timed out");
  }

  async parseLayout(doc: DocumentInput): Promise<LayoutParseResult> {
    const body = await this.analyze(this.cfg.layoutModel ?? "prebuilt-layout", doc);
    const result = body.analyzeResult;
    if (!result) throw new Error("azure-di: succeeded without analyzeResult");
    const dims: PageDims = new Map(
      result.pages.map((p) => [p.pageNumber, { width: p.width, height: p.height }]),
    );

    const tablesByPage = new Map<number, unknown[]>();
    for (const t of result.tables ?? []) {
      const firstRegion = t.boundingRegions[0];
      if (!firstRegion) continue;
      const page = firstRegion.pageNumber;
      const list = tablesByPage.get(page) ?? [];
      list.push({
        page,
        bbox: polygonToBbox(firstRegion.polygon, page, dims),
        cells: t.cells.map((c) => {
          const cellRegion = c.boundingRegions[0];
          if (!cellRegion) throw new Error("azure-di: cell without region");
          return {
            text: c.content,
            bbox: polygonToBbox(cellRegion.polygon, cellRegion.pageNumber, dims),
            rowIndex: c.rowIndex,
            colIndex: c.columnIndex,
          };
        }),
      });
      tablesByPage.set(page, list);
    }

    const pages = result.pages.map((p) =>
      layoutPageSchema.parse({
        page: p.pageNumber,
        textBlocks: (p.lines ?? []).map((l) => ({
          text: l.content,
          bbox: polygonToBbox(l.polygon, p.pageNumber, dims),
        })),
        tables: tablesByPage.get(p.pageNumber) ?? [],
      }),
    );

    return {
      pages,
      run: {
        vendor: this.name,
        vendorVersion: this.version,
        model: this.cfg.layoutModel ?? "prebuilt-layout",
        pageCount: result.pages.length,
        costMicroUsd: BigInt(result.pages.length) * this.perPage,
      },
    };
  }

  async extractFields(doc: DocumentInput, fields: FieldRequest[]): Promise<FieldExtractionResult> {
    const model = this.cfg.taxModel ?? "prebuilt-tax.us";
    const body = await this.analyze(model, doc);
    const result = body.analyzeResult;
    if (!result) throw new Error("azure-di: succeeded without analyzeResult");
    const dims: PageDims = new Map(
      result.pages.map((p) => [p.pageNumber, { width: p.width, height: p.height }]),
    );
    const vendorFields = result.documents?.[0]?.fields ?? {};

    // Registry supplies Azure's field names via aliases (M4.1): try the
    // fieldId itself, then each alias, first hit wins.
    const candidates = fields.map((f) => {
      const names = [f.fieldId, ...(f.aliases ?? [])];
      const hit = names.map((n) => vendorFields[n]).find((v) => v !== undefined);
      const valueText = hit?.valueString ?? hit?.content ?? null;
      const firstRegion = hit?.boundingRegions?.[0];
      return fieldCandidateSchema.parse({
        fieldId: f.fieldId,
        valueText,
        page: valueText === null ? null : (firstRegion?.pageNumber ?? null),
        bbox:
          valueText !== null && firstRegion
            ? polygonToBbox(firstRegion.polygon, firstRegion.pageNumber, dims)
            : null,
        confidence: Math.min(1, Math.max(0, hit?.confidence ?? 0)),
      });
    });

    return {
      candidates,
      run: {
        vendor: this.name,
        vendorVersion: this.version,
        model,
        pageCount: result.pages.length,
        costMicroUsd: BigInt(result.pages.length) * this.perPage,
      },
    };
  }
}
