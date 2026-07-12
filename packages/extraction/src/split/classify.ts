/**
 * Page classification (M3.5): deterministic signals first, vision/text LLM
 * second, unresolved pages routed to review — never guessed (Blueprint §4.1).
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { formFamilySchema, type FormFamily } from "@credexis/schema";
import { detectPageSignals } from "./signals.js";

export interface PageInput {
  /** 1-based page number within the uploaded bundle. */
  page: number;
  /** Text layer / OCR text (from the layout adapter). */
  text: string;
  /** Optional rendered thumbnail (pipeline M3.1 provides these). */
  imagePng?: Uint8Array;
}

export interface PageClassification {
  page: number;
  formFamily: FormFamily | null;
  taxYear: number | null;
  isDocumentStart: boolean;
  confidence: number;
  method: "deterministic" | "llm" | "unresolved";
  matched: string[];
}

/** LLM fallback contract — mockable in tests, Anthropic in production. */
export interface PageClassifier {
  classifyPages(pages: PageInput[]): Promise<PageClassification[]>;
}

/**
 * Deterministic-first combinator: only pages the printed signals could not
 * resolve are sent to the (costly) classifier; pages neither can resolve
 * come back `unresolved` with confidence 0 — the review queue's problem,
 * never a silent guess.
 */
export async function classifyBundle(
  pages: PageInput[],
  llm: PageClassifier | null,
): Promise<PageClassification[]> {
  const results = new Map<number, PageClassification>();
  const unresolved: PageInput[] = [];

  for (const p of pages) {
    const s = detectPageSignals(p.text);
    if (s.formFamily !== null) {
      results.set(p.page, {
        page: p.page,
        formFamily: s.formFamily,
        taxYear: s.taxYear,
        isDocumentStart: s.isDocumentStart,
        confidence: s.confidence,
        method: "deterministic",
        matched: s.matched,
      });
    } else {
      unresolved.push(p);
    }
  }

  if (unresolved.length > 0 && llm) {
    for (const c of await llm.classifyPages(unresolved)) {
      results.set(c.page, c);
    }
  }

  return pages.map(
    (p) =>
      results.get(p.page) ?? {
        page: p.page,
        formFamily: null,
        taxYear: null,
        isDocumentStart: false,
        confidence: 0,
        method: "unresolved" as const,
        matched: [],
      },
  );
}

/* ────────────────────────────────────────────────────────────────────── */

const llmResponseSchema = z.object({
  pages: z.array(
    z.object({
      page: z.number().int(),
      form_family: z.string().nullable(),
      tax_year: z.number().int().nullable(),
      is_document_start: z.boolean(),
      confidence: z.number(),
    }),
  ),
});

const LLM_JSON_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          form_family: {
            type: ["string", "null"],
            enum: [...formFamilySchema.options, null],
          },
          tax_year: { type: ["integer", "null"] },
          is_document_start: { type: "boolean" },
          confidence: { type: "number" },
        },
        required: ["page", "form_family", "tax_year", "is_document_start", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["pages"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You classify pages of financial/tax document bundles.
For each page, identify which document type it belongs to (or null if you
cannot tell — null is always acceptable, guessing is not), the tax year if
printed, and whether the page is the FIRST page of a document (form headers,
title blocks) vs a continuation. You never infer values, only classify.`;

export interface AnthropicPageClassifierConfig {
  apiKey: string;
  model?: string; // Blueprint §4.1: Haiku-class for page classification
  fetch?: typeof globalThis.fetch;
}

/** Vision/text LLM classification (Blueprint §4.1 second pass). */
export class AnthropicPageClassifier implements PageClassifier {
  private client: Anthropic;
  readonly model: string;

  constructor(cfg: AnthropicPageClassifierConfig) {
    this.model = cfg.model ?? "claude-haiku-4-5";
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
    });
  }

  async classifyPages(pages: PageInput[]): Promise<PageClassification[]> {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const p of pages) {
      if (p.imagePng) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: Buffer.from(p.imagePng).toString("base64"),
          },
        });
      }
      content.push({
        type: "text",
        text: `--- PAGE ${p.page} ---\n${p.text.slice(0, 4000)}`,
      });
    }
    content.push({
      type: "text",
      text: `Classify each of the ${pages.length} pages above. Valid form_family values: ${formFamilySchema.options.join(", ")} or null.`,
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: LLM_JSON_SCHEMA } },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("page-classifier: request refused");
    }
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("page-classifier: no text block");
    const parsed = llmResponseSchema.parse(JSON.parse(textBlock.text));

    const byPage = new Map(parsed.pages.map((p) => [p.page, p]));
    return pages.map((p) => {
      const r = byPage.get(p.page);
      const family = formFamilySchema.safeParse(r?.form_family);
      return {
        page: p.page,
        formFamily: family.success ? family.data : null,
        taxYear: r?.tax_year ?? null,
        isDocumentStart: r?.is_document_start ?? false,
        confidence: r ? Math.min(1, Math.max(0, r.confidence)) : 0,
        method: "llm" as const,
        matched: ["llm"],
      };
    });
  }
}
