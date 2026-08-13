/**
 * Page classification (M3.5): deterministic signals first, vision/text LLM
 * second, unresolved pages routed to review — never guessed (Blueprint §4.1).
 *
 * The LLM's claims are STRUCTURALLY validated (M13.1, first-deal
 * walkthrough): the model must report the form number printed as the
 * page's own header, the code maps that print to a family (an unknown
 * print abstains instead of snapping to the nearest known form), and a
 * claim whose only textual basis is a citation ("attach Form 1125-E") is
 * vetoed - the same invariants #177 gave the regex path. Instructions
 * alone ("guessing is not acceptable") demonstrably did not hold.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { formFamilySchema, type FormFamily } from "@credexis/schema";
import { detectPageSignals, familyTokenEvidence } from "./signals.js";

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
      /** The form/schedule number printed as THIS page's own header or
       *  footer ("1120", "4626", "1125-E", "Schedule K-1 (Form 1065)") -
       *  never one a line item merely cites. Null when no form identity
       *  is printed. The CODE maps this to a family; the model does not
       *  get to pick the nearest known one. */
      printed_form: z.string().nullable(),
      tax_year: z.number().int().nullable(),
      is_document_start: z.boolean(),
      confidence: z.number(),
    }),
  ),
});

/** Statement families and honesty labels pass through without a printed
 *  token (statements have no form number; NON_FORM is the absence of one). */
const TOKENLESS_FAMILIES: ReadonlySet<FormFamily> = new Set([
  "PNL",
  "BALANCE_SHEET",
  "DEBT_SCHEDULE",
  "NON_FORM",
]);

/** Canonical print → family. Fail-closed: a print that maps to nothing
 *  (a 5472, an 8949, a garbled read) abstains - it never snaps to the
 *  nearest known form (the 4626→4562 bug). */
function printedFormToFamily(printed: string): FormFamily | null {
  const up = printed.toUpperCase().replace(/\s+/g, " ").trim();
  const k1 = /^SCHEDULE K-?1 \(FORM (1120-?S|1065)\)$/.exec(up);
  if (k1) return k1[1] === "1065" ? "K1_1065" : "K1_1120S";
  const sched = /^SCHEDULE ([1CEF]) \(FORM 1040(?: OR 1040-?SR)?\)$/.exec(up);
  if (sched) {
    return ({ "1": "1040_SCH_1", C: "1040_SCH_C", E: "1040_SCH_E", F: "1040_SCH_F" } as const)[
      sched[1] as "1" | "C" | "E" | "F"
    ];
  }
  const bare = up.replace(/^FORM /, "");
  const table: Record<string, FormFamily> = {
    "1120": "1120",
    "1120S": "1120S",
    "1120-S": "1120S",
    "1065": "1065",
    "1040": "1040",
    "1040-SR": "1040",
    "4562": "4562",
    "4626": "4626",
    "8825": "8825",
    "1125E": "1125E",
    "1125-E": "1125E",
    W2: "W2",
    "W-2": "W2",
    "SCHEDULE C": "1040_SCH_C",
    "SCHEDULE E": "1040_SCH_E",
    "SCHEDULE F": "1040_SCH_F",
    "SCHEDULE 1": "1040_SCH_1",
  };
  return table[bare] ?? null;
}

/**
 * Structural validation of one LLM page claim (exported for tests).
 * Returns the family the claim actually supports, or null (abstain).
 */
export function validateLlmClaim(
  claim: { form_family: string | null; printed_form: string | null },
  pageText: string,
): FormFamily | null {
  const parsed = formFamilySchema.safeParse(claim.form_family);
  if (!parsed.success) return null;
  const family = parsed.data;
  if (TOKENLESS_FAMILIES.has(family)) return family;

  // 1. The printed identity must exist and must map to the claimed family.
  //    An unknown print abstains rather than snapping to a neighbor.
  if (claim.printed_form === null) return null;
  if (printedFormToFamily(claim.printed_form) !== family) return null;

  // 2. Citation veto (#177's invariant, ported): when the text layer's
  //    only mention of the claimed token is a citation, the page talks
  //    ABOUT the form - it is not the form. "absent" is allowed: on a
  //    garbled scan the image is legitimately the only evidence.
  if (familyTokenEvidence(pageText, family) === "cited-only") return null;

  return family;
}

const LLM_JSON_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          // anyOf, not type-union + enum: the API's schema validator
          // rejects enum values inside a union type (live finding, 2026-07-19).
          form_family: {
            anyOf: [{ type: "string", enum: [...formFamilySchema.options] }, { type: "null" }],
          },
          printed_form: { anyOf: [{ type: "string" }, { type: "null" }] },
          tax_year: { anyOf: [{ type: "integer" }, { type: "null" }] },
          is_document_start: { type: "boolean" },
          confidence: { type: "number" },
        },
        required: [
          "page",
          "form_family",
          "printed_form",
          "tax_year",
          "is_document_start",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["pages"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You classify pages of financial/tax document bundles.
For each page report:
- printed_form: the form or schedule number printed as THIS page's OWN
  header or footer (examples: "1120", "4626", "1125-E", "Schedule K-1
  (Form 1065)", "W-2"). A form number a line item merely CITES - "attach
  Form 1125-E", "from Form 4562" - is another document's name, never this
  page's identity. Null when no form identity is printed on the page.
- form_family: the matching family from the allowed list; NON_FORM for
  cover sheets, fax banners, separator and instruction pages; a statement
  family for CPA-prepared financials; null if you cannot tell. If the
  printed form is not in the allowed list, use null - never the
  closest-looking family.
- tax_year if printed, whether the page is the FIRST page of a document
  (form headers, title blocks) vs a continuation, and your confidence.
Null is always acceptable; guessing is not. You never infer values, only
classify.`;

/** Token usage of one classifier API call, as reported to `onUsage`. Cache
 *  tokens are billed too (writes at 1.25x the input rate, reads at 0.1x) —
 *  omitting them under-reported spend on every cached call. */
export interface ClassifierUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface AnthropicPageClassifierConfig {
  apiKey: string;
  model?: string; // Blueprint §4.1: Haiku-class for page classification
  fetch?: typeof globalThis.fetch;
  /** Token usage per API call — the pipeline's cost recorder (M3.2) hooks in here. */
  onUsage?: (usage: ClassifierUsage) => void;
}

/** Vision/text LLM classification (Blueprint §4.1 second pass). */
export class AnthropicPageClassifier implements PageClassifier {
  private client: Anthropic;
  private onUsage: AnthropicPageClassifierConfig["onUsage"];
  readonly model: string;

  constructor(cfg: AnthropicPageClassifierConfig) {
    this.model = cfg.model ?? "claude-haiku-4-5";
    this.onUsage = cfg.onUsage;
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
    });
  }

  /**
   * Image-bearing pages are batched (M13.6): a scanned bundle can be
   * dozens of ~700KB PNGs, and one request carrying all of them exceeds
   * the API's payload ceiling - the whole call fails and every page comes
   * back unresolved. Text-only pages still go in one request, so native
   * PDFs are unchanged.
   */
  private static readonly IMAGE_BATCH = 4;

  async classifyPages(pages: PageInput[]): Promise<PageClassification[]> {
    const batches = AnthropicPageClassifier.batch(pages);
    if (batches.length === 1) return this.classifyBatch(pages);
    const out: PageClassification[] = [];
    for (const b of batches) out.push(...(await this.classifyBatchSafely(b)));
    return out;
  }

  /**
   * Close a batch on IMAGE count, not page count: text-only pages cost
   * almost nothing and ride along free. Counting pages instead split a
   * 60-page bundle holding 5 scans into 15 requests - 15x the overhead and
   * 15x the exposure to a transient vendor error, on exactly the bundles
   * that are already the slowest.
   */
  private static batch(pages: PageInput[]): PageInput[][] {
    const batches: PageInput[][] = [];
    let current: PageInput[] = [];
    let images = 0;
    for (const p of pages) {
      if (images === AnthropicPageClassifier.IMAGE_BATCH && current.length > 0) {
        batches.push(current);
        current = [];
        images = 0;
      }
      current.push(p);
      if (p.imagePng) images += 1;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  /**
   * One failed batch must not discard the whole bundle. Rejecting here
   * would reject classifyBundle, fail the document, and throw away every
   * page the DETERMINISTIC layer already resolved correctly. Unresolved
   * pages go to review, which is the honest outcome (Iron Law #6) - and
   * the marker keeps the failure countable rather than silent.
   */
  private async classifyBatchSafely(batch: PageInput[]): Promise<PageClassification[]> {
    try {
      return await this.classifyBatch(batch);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return batch.map((p) => ({
        page: p.page,
        formFamily: null,
        taxYear: null,
        isDocumentStart: false,
        confidence: 0,
        method: "unresolved",
        matched: [`llm-error:${message.slice(0, 80)}`],
      }));
    }
  }

  private async classifyBatch(pages: PageInput[]): Promise<PageClassification[]> {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const p of pages) {
      // The page number is announced BEFORE the image (Iron Law #4). With
      // the image first, the only thing tying it to a page was its position
      // relative to the next text block - and on an all-scan bundle every
      // text block is an empty "--- PAGE n ---" marker, so one off-by-one
      // silently relabels an entire return at full confidence. Naming the
      // page first makes the binding explicit rather than ordinal.
      content.push({ type: "text", text: `--- PAGE ${p.page} ---` });
      if (p.imagePng) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: Buffer.from(p.imagePng).toString("base64"),
          },
        });
        content.push({ type: "text", text: `(image above IS page ${p.page})` });
      }
      content.push({
        type: "text",
        text: p.text.trim() === "" ? "(no text layer)" : p.text.slice(0, 4000),
      });
    }
    content.push({
      type: "text",
      text: `Classify each of the ${pages.length} pages above. Valid form_family values: ${formFamilySchema.options.join(", ")} or null.`,
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      // The system prompt is the stable prefix shared by every batch of a
      // bundle (and across bundles). Below the model's minimum cacheable
      // length the marker is a documented no-op, so it is safe to set
      // unconditionally — and pricing below already counts cache tokens.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: LLM_JSON_SCHEMA } },
      messages: [{ role: "user", content }],
    });

    this.onUsage?.({
      model: this.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
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
      // Structural validation: the code, not the model, decides whether
      // the claimed identity is supported by the page (M13.1).
      const family = r ? validateLlmClaim(r, p.text) : null;
      const vetoed = r !== undefined && r.form_family !== null && family === null;
      return {
        page: p.page,
        formFamily: family,
        taxYear: r?.tax_year ?? null,
        isDocumentStart: family === null ? false : (r?.is_document_start ?? false),
        confidence: family === null ? 0 : Math.min(1, Math.max(0, r?.confidence ?? 0)),
        method: "llm" as const,
        matched: vetoed ? ["llm", `llm-vetoed:${r?.form_family}`] : ["llm"],
      };
    });
  }
}
