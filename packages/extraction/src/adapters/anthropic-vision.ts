/**
 * Path-2 extractor (M3.3 / M4.3): Claude vision with structured outputs
 * (Blueprint §4.2). Independent of Path 1 — this adapter never sees Path-1
 * values (the consensus reconciler M4.4 compares the two downstream).
 *
 * Iron-law notes:
 * - The model classifies and locates; it never computes. The structured
 *   output schema forces `value_text` to be the raw printed text; prompting
 *   demands null when absent/illegible (Iron Law #1).
 * - Blueprint §4.2 asked for "temperature 0"; sampling parameters no longer
 *   exist on current Claude models (400 if sent). The determinism intent is
 *   met by structured outputs + explicit never-guess prompting instead.
 * - Cost is tracked in integer micro-USD from real token usage
 *   (standing order #9).
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  createMessageMaybeBatch,
  priceUsageMicroUsd,
  type BatchOptions,
} from "./anthropic-batch.js";
import { z } from "zod";
import {
  fieldCandidateSchema,
  type DocumentInput,
  type ExtractorAdapter,
  type FieldExtractionResult,
  type FieldRequest,
  type LayoutParseResult,
} from "../types.js";

export interface AnthropicVisionConfig {
  apiKey: string;
  /** Blueprint §4.2: Sonnet-class for cost; overridable for the bake-off. */
  model?: string;
  /** Pricing (integer micro-USD per MTok) for cost accounting. */
  inputMicroUsdPerMtok?: bigint;
  outputMicroUsdPerMtok?: bigint;
  /** Injectable transport — contract tests pass a recorded-response fetch. */
  fetch?: typeof globalThis.fetch;
  /** Route through the Message Batches API (50%% off, latency-tolerant callers only). */
  batch?: BatchOptions | null;
}

const DEFAULT_MODEL = "claude-sonnet-5";
/** Sticker pricing 2026-07 (Sonnet 5: $3/$15 per MTok). [PRATIK] verify at bake-off. */
const DEFAULT_INPUT_RATE = 3_000_000n;
const DEFAULT_OUTPUT_RATE = 15_000_000n;

/** What the model must return — enforced by structured outputs. */
const responseSchema = z.object({
  candidates: z.array(
    z.object({
      field_id: z.string(),
      value_text: z.string().nullable(),
      cents_box_text: z.string().nullable(),
      page: z.number().int().nullable(),
      confidence: z.number(),
    }),
  ),
});

/** JSON schema handed to the API (structured outputs: no numeric bounds). */
const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field_id: { type: "string" },
          value_text: { type: ["string", "null"] },
          cents_box_text: { type: ["string", "null"] },
          page: { type: ["integer", "null"] },
          confidence: { type: "number" },
        },
        required: ["field_id", "value_text", "cents_box_text", "page", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

/** Frozen system prompt — stable prefix, prompt-cache friendly. */
const SYSTEM_PROMPT = `You are a document field locator for financial/tax documents.

Rules (absolute):
1. You NEVER compute, sum, or infer a value. You only transcribe text that is
   physically printed on the document.
2. For each requested field, return value_text as the EXACT raw text printed
   in that field's value position — keep commas, parentheses, currency
   symbols, and dashes exactly as printed. Do not normalize.
3. If a field is blank, dashed out, illegible, or you cannot find it,
   return value_text: null. NEVER guess. A wrong value is far worse than null.
4. If the field has a separate cents box, put its raw contents in
   cents_box_text (null if none/empty).
5. page is the 1-based page where you read the value (null when value_text
   is null).
6. confidence is your honest 0..1 estimate that value_text is a verbatim
   transcription of the right field.`;

function mediaBlock(doc: DocumentInput): Anthropic.ContentBlockParam {
  const data = Buffer.from(doc.bytes).toString("base64");
  if (doc.mimeType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  // TIFF isn't accepted by the vision API — callers must pre-render (M3.5
  // renders pages to PNG anyway). Guarded here so it fails loud, not weird.
  if (doc.mimeType === "image/tiff") {
    throw new Error("anthropic-vision: TIFF must be pre-rendered to PNG/JPEG");
  }
  return {
    type: "image",
    source: { type: "base64", media_type: doc.mimeType, data },
  };
}

export class AnthropicVisionAdapter implements ExtractorAdapter {
  readonly name = "anthropic-vision";
  readonly version = "1";
  readonly model: string;
  private client: Anthropic;
  private inRate: bigint;
  private outRate: bigint;
  private batch: BatchOptions | null;

  constructor(cfg: AnthropicVisionConfig) {
    this.model = cfg.model ?? DEFAULT_MODEL;
    this.inRate = cfg.inputMicroUsdPerMtok ?? DEFAULT_INPUT_RATE;
    this.outRate = cfg.outputMicroUsdPerMtok ?? DEFAULT_OUTPUT_RATE;
    this.batch = cfg.batch ?? null;
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
    });
  }

  /** Layout parsing is a specialized-vendor job (Blueprint §4.3 rule). */
  parseLayout(_doc: DocumentInput): Promise<LayoutParseResult> {
    return Promise.reject(
      new Error("anthropic-vision does not parse layout — use the layout vendor adapter"),
    );
  }

  async extractFields(doc: DocumentInput, fields: FieldRequest[]): Promise<FieldExtractionResult> {
    const fieldList = fields
      .map((f) => {
        const aliases = f.aliases?.length ? ` (also appears as: ${f.aliases.join("; ")})` : "";
        const hint = f.pageHint ? ` [usually page ${f.pageHint}]` : "";
        const cents = f.hasCentsBox ? " [has separate cents box]" : "";
        const note = f.hint ? ` NOTE: ${f.hint}` : "";
        return `- ${f.fieldId}: "${f.label}"${aliases}${hint} (${f.dtype})${cents}${note}`;
      })
      .join("\n");

    // Field definitions are identical for every document of a (family,
    // year) — a cacheable prefix. The variable document follows in the
    // user turn, so cache hits cover instructions + field list + schema.
    const { message: response, batched } = await createMessageMaybeBatch(
      this.client,
      {
        model: this.model,
        max_tokens: 16000,
        thinking: { type: "disabled" },
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          {
            type: "text",
            text: `Fields to locate (one candidate per field id; value_text null when absent):\n${fieldList}`,
            cache_control: { type: "ephemeral" },
          },
        ],
        output_config: {
          format: { type: "json_schema", schema: RESPONSE_JSON_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: [
              mediaBlock(doc),
              {
                type: "text",
                text: "Locate and transcribe the requested fields in this document.",
              },
            ],
          },
        ],
      },
      this.batch,
    );

    if (response.stop_reason === "refusal") {
      throw new Error("anthropic-vision: request refused by safety classifiers");
    }
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("anthropic-vision: no text block in response");

    const parsed = responseSchema.parse(JSON.parse(textBlock.text));
    const byRequested = new Map(parsed.candidates.map((c) => [c.field_id, c]));

    // Every requested field yields exactly one candidate — missing ones are
    // explicit nulls, not silent absences (never-guess includes never-omit).
    const candidates = fields.map((f) => {
      const c = byRequested.get(f.fieldId);
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      return fieldCandidateSchema.parse({
        fieldId: f.fieldId,
        valueText: c?.value_text ?? null,
        centsBoxText: c?.cents_box_text ?? null,
        page: c?.value_text === null ? null : (c?.page ?? null),
        bbox: null, // Path 2 has no geometry; consensus takes bbox from Path 1
        confidence: c ? clamp(c.confidence) : 0,
      });
    });

    return {
      candidates,
      run: {
        vendor: this.name,
        vendorVersion: this.version,
        model: response.model,
        pageCount: doc.pageCount ?? 1,
        costMicroUsd: priceUsageMicroUsd(response.usage, this.inRate, this.outRate, batched),
      },
    };
  }
}
