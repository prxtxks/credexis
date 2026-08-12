/**
 * Taxonomy mapper (M5.4, Blueprint §4.3 step 4) — the ONLY LLM step in the
 * statement path, and it never sees a number.
 *
 * Resolution order per label:
 *   tenant exact → tenant fuzzy (≥95) → global exact → global fuzzy (≥95)
 *   → LLM batch classification (labels only) → unmapped → review.
 *
 * LLM classifications write back as tenant-scoped learned mappings
 * (source "llm"), so the second identical document costs ZERO LLM calls
 * (the cost-decay guarantee, tested). Confirmed human corrections upgrade
 * mappings to source "human" — V1's one good idea, kept and tenant-scoped.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createMessageMaybeBatch, type BatchOptions } from "../adapters/anthropic-batch.js";
import { z } from "zod";
import { TAXONOMY_V1 } from "@credexis/schema";

/* ── learned mappings store (DB impl binds to learned_mappings, M2.1) ── */

export interface LearnedMapping {
  labelNorm: string;
  taxonomyNodeKey: string;
  confidence: number;
  source: "human" | "llm";
  usageCount: number;
}

export interface LearnedMappingsStore {
  /** tenantId null = the global pool. */
  findExact(tenantId: string | null, labelNorm: string): Promise<LearnedMapping | null>;
  listAll(tenantId: string | null): Promise<LearnedMapping[]>;
  upsert(tenantId: string | null, mapping: LearnedMapping): Promise<void>;
}

/** In-memory store — unit tests + the future DB impl's reference contract. */
export class InMemoryMappingsStore implements LearnedMappingsStore {
  private pools = new Map<string, Map<string, LearnedMapping>>();

  private pool(tenantId: string | null): Map<string, LearnedMapping> {
    const key = tenantId ?? "(global)";
    let p = this.pools.get(key);
    if (!p) {
      p = new Map();
      this.pools.set(key, p);
    }
    return p;
  }

  findExact(tenantId: string | null, labelNorm: string): Promise<LearnedMapping | null> {
    return Promise.resolve(this.pool(tenantId).get(labelNorm) ?? null);
  }
  listAll(tenantId: string | null): Promise<LearnedMapping[]> {
    return Promise.resolve([...this.pool(tenantId).values()]);
  }
  upsert(tenantId: string | null, mapping: LearnedMapping): Promise<void> {
    const existing = this.pool(tenantId).get(mapping.labelNorm);
    // A human mapping is never downgraded by an LLM write-back.
    if (existing?.source === "human" && mapping.source === "llm") return Promise.resolve();
    this.pool(tenantId).set(mapping.labelNorm, mapping);
    return Promise.resolve();
  }
}

/* ── normalization + fuzzy matching ────────────────────────────────── */

/**
 * Label normalization: the identity used for learning and lookup.
 * KEEP IN SYNC with the inline copy in packages/schema seed-api.ts.
 *
 * Account-code stripping (annual P&L finding, 2026-07-22): QuickBooks
 * charts print "60400 Bank Service Charges" / "301.1 Cash Revenue" /
 * "Total 63300 Insurance Expense". The code is presentation, not
 * meaning — strip LEADING 3-5 digit tokens (and their dotted
 * sub-account digits) so the label matches its code-free vocabulary.
 * Mid-label numbers ("Section 179 Deduction") and digit-letter tokens
 * ("401k Match") are never touched.
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(total (?:for )?)?\d{3,5}(?: \d{1,4})* /, "$1")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Similarity ratio in [0,1]; the ≥0.95 bar is the blueprint's "fuzzy ≥95". */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

const FUZZY_THRESHOLD = 0.95;

function fuzzyFind(labelNorm: string, pool: LearnedMapping[]): LearnedMapping | null {
  let best: LearnedMapping | null = null;
  let bestScore = FUZZY_THRESHOLD;
  for (const m of pool) {
    const s = similarity(labelNorm, m.labelNorm);
    if (s >= bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

/* ── LLM label classifier (labels ONLY — never a number) ───────────── */

export interface LabelClassification {
  label: string;
  taxonomyNodeKey: string | null;
  confidence: number;
}

export interface LabelClassifier {
  classifyLabels(
    labels: string[],
    statement: "PNL" | "BALANCE_SHEET",
  ): Promise<LabelClassification[]>;
}

const llmResponseSchema = z.object({
  mappings: z.array(
    z.object({
      label: z.string(),
      taxonomy_node: z.string().nullable(),
      confidence: z.number(),
    }),
  ),
});

/**
 * Mapping guidance baked into the cached prefix: curated from the domain
 * mapping doc and real-corpus findings (hotels, gas stations). Doubles as
 * the ballast that lifts the cacheable prefix past the model minimum.
 */
const MAPPING_GUIDANCE = `Common label patterns (pattern → node):
- Room Revenue / Room Rental / Occupancy revenue → is.revenue.rental_income
- Franchise Fee / Royalty Fees / Brand fees → is.opex.royalties_franchise
- OTA Fees / Travel Agent Fees / Booking commissions → is.opex.commissions_paid
- Merchant account fees / Credit card fees / Card processing → is.opex.merchant_fees
- Payroll Expenses / Salaries / Wages / Staff pay → is.opex.salaries_wages
- Officer salary / Owner compensation / Member draws (as comp) → is.opex.officer_comp
- Payroll taxes / Employer taxes / FICA → is.opex.payroll_taxes
- Interest paid / Interest expense / Loan interest → is.other.interest_expense
- Bank fees / Bank service charges / NSF fees → is.opex.bank_charges
- Heating & cooling / Electric / Gas / Water & sewer → is.opex.utilities
- Phone / Internet & TV / Cell service → is.opex.telephone_internet
- Trash removal / Pest control / Snow removal → is.opex.misc
- Business licenses / Permits / Regulatory fees → is.opex.licenses_permits
- Legal & Accounting / CPA fees / Attorney fees → is.opex.professional_fees
- Dues & subscriptions / Memberships → is.opex.dues_subscriptions
- Supplies & materials / Operating supplies → is.opex.supplies
- Office supplies / Office expense → is.opex.office_expense
- Shipping & postage / Freight out → is.opex.postage_shipping
- Software & apps / POS fees / Technology → is.opex.software
- Vehicle gas & fuel / Auto expense → is.opex.fuel or is.opex.vehicle
- Checking / Savings / Petty cash / Cash on hand → bs.assets.current.cash
- Accounts receivable / Trade receivables → bs.assets.current.accounts_receivable
- Inventories / Stock on hand → bs.assets.current.inventory
- Building / Land / Equipment / Furniture / Improvements → bs.assets.fixed.* items
- Accumulated depreciation (negative) → contra within bs.assets.fixed
- Goodwill / Closing costs / Loan costs → bs.assets.other.*
- Sales tax payable / Accrued expenses → bs.liabilities.current.*
- Loan / Mortgage / SBA note (long term) → bs.liabilities.longterm.*
Rules:
- Totals map to the section .total node, never to a line item.
- A label naming a person or company alone is not mappable → null.
- Sub-account labels ("Insurance:Business") map by their leaf meaning.`;

export class AnthropicLabelClassifier implements LabelClassifier {
  private client: Anthropic;
  readonly model: string;
  private batch: BatchOptions | null;

  constructor(cfg: {
    apiKey: string;
    model?: string;
    fetch?: typeof globalThis.fetch;
    /** Message Batches API (50% off) — eval/bake-off callers only. */
    batch?: BatchOptions | null;
  }) {
    this.model = cfg.model ?? "claude-haiku-4-5";
    this.batch = cfg.batch ?? null;
    this.client = new Anthropic({ apiKey: cfg.apiKey, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) });
  }

  async classifyLabels(
    labels: string[],
    statement: "PNL" | "BALANCE_SHEET",
  ): Promise<LabelClassification[]> {
    const prefix = statement === "PNL" ? "is." : "bs.";
    const nodes = TAXONOMY_V1.filter((n) => n.key.startsWith(prefix)).map((n) => n.key);
    // The cached block carries the FULL chart of accounts (both statement
    // kinds, keys AND labels): one shared prefix for every call regardless
    // of statement, comfortably above the model minimum cacheable length
    // (Haiku: 2048 tokens). The schema enum still restricts answers to
    // the current statement.
    const nodeCatalog = TAXONOMY_V1.filter(
      (n) => n.key.startsWith("is.") || n.key.startsWith("bs."),
    )
      .map((n) => `${n.key} — ${n.label}`)
      .join("\n");

    // The taxonomy list is identical for every call of a statement kind —
    // a cacheable prefix (~200 nodes); labels vary per call in the user turn.
    const { message: response } = await createMessageMaybeBatch(
      this.client,
      {
        model: this.model,
        max_tokens: 8000,
        system: [
          {
            type: "text",
            text:
              "You map financial statement line-item LABELS to a canonical chart of accounts. " +
              "You only ever see labels — never amounts. Return null when no node fits; " +
              "guessing is worse than null.",
          },
          {
            type: "text",
            text: `Chart of accounts (key — meaning):\n${nodeCatalog}\n\n${MAPPING_GUIDANCE}`,
            cache_control: { type: "ephemeral" },
          },
        ],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                mappings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      // anyOf, not mixed type+enum: the API validates each
                      // enum member against the declared type and rejects the
                      // union form (found live, 2026-07-20).
                      taxonomy_node: {
                        anyOf: [{ type: "string", enum: nodes }, { type: "null" }],
                      },
                      confidence: { type: "number" },
                    },
                    required: ["label", "taxonomy_node", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["mappings"],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: "user",
            content: `Statement kind: ${statement}. Map each label to one node key valid for this statement (or null):\n${labels.map((l) => `- ${l}`).join("\n")}`,
          },
        ],
      },
      this.batch,
    );

    if (response.stop_reason === "refusal") throw new Error("label-classifier: refused");
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("label-classifier: no text block");
    const parsed = llmResponseSchema.parse(JSON.parse(textBlock.text));

    const valid = new Set(nodes);
    const byLabel = new Map(parsed.mappings.map((m) => [m.label, m]));
    return labels.map((label) => {
      const m = byLabel.get(label);
      const node = m?.taxonomy_node ?? null;
      return {
        label,
        taxonomyNodeKey: node !== null && valid.has(node) ? node : null,
        confidence: m ? Math.min(1, Math.max(0, m.confidence)) : 0,
      };
    });
  }
}

/* ── the mapper ─────────────────────────────────────────────────────── */

export type MappingMethod =
  | "exact_tenant"
  | "fuzzy_tenant"
  | "exact_global"
  | "fuzzy_global"
  | "llm"
  | "unmapped";

export interface MappedLabel {
  label: string;
  labelNorm: string;
  taxonomyNodeKey: string | null;
  method: MappingMethod;
  confidence: number;
}

/**
 * Container nodes aggregate their children; a statement VALUE mapped onto
 * one displays as the aggregate's own number (the Golden Deal's $349
 * "Operating expenses", M14.7). Any resolution targeting a container -
 * learned, fuzzy, or LLM - demotes to unmapped: the review queue owns the
 * judgment, and the bad answer is never learned.
 */
const CONTAINER_KEYS: ReadonlySet<string> = new Set(
  TAXONOMY_V1.map((n) => n.parentKey).filter((k): k is string => k !== null),
);

function leafOnly(m: MappedLabel): MappedLabel {
  if (m.taxonomyNodeKey === null || !CONTAINER_KEYS.has(m.taxonomyNodeKey)) return m;
  return { ...m, taxonomyNodeKey: null, method: "unmapped", confidence: 0 };
}

export async function mapLabels(
  labels: string[],
  statement: "PNL" | "BALANCE_SHEET",
  tenantId: string,
  store: LearnedMappingsStore,
  classifier: LabelClassifier | null,
): Promise<MappedLabel[]> {
  const results = new Map<string, MappedLabel>();
  const unresolved: string[] = [];

  const tenantPool = await store.listAll(tenantId);
  const globalPool = await store.listAll(null);

  for (const label of labels) {
    const labelNorm = normalizeLabel(label);
    if (results.has(label)) continue;

    const tenantExact = await store.findExact(tenantId, labelNorm);
    if (tenantExact) {
      results.set(label, leafOnly(hit(label, labelNorm, tenantExact, "exact_tenant")));
      continue;
    }
    const tenantFuzzy = fuzzyFind(labelNorm, tenantPool);
    if (tenantFuzzy) {
      results.set(label, leafOnly(hit(label, labelNorm, tenantFuzzy, "fuzzy_tenant")));
      continue;
    }
    const globalExact = await store.findExact(null, labelNorm);
    if (globalExact) {
      results.set(label, leafOnly(hit(label, labelNorm, globalExact, "exact_global")));
      continue;
    }
    const globalFuzzy = fuzzyFind(labelNorm, globalPool);
    if (globalFuzzy) {
      results.set(label, leafOnly(hit(label, labelNorm, globalFuzzy, "fuzzy_global")));
      continue;
    }
    unresolved.push(label);
  }

  if (unresolved.length > 0 && classifier) {
    for (const c of await classifier.classifyLabels(unresolved, statement)) {
      const labelNorm = normalizeLabel(c.label);
      const resolved = leafOnly({
        label: c.label,
        labelNorm,
        taxonomyNodeKey: c.taxonomyNodeKey,
        method: c.taxonomyNodeKey === null ? "unmapped" : "llm",
        confidence: c.confidence,
      });
      results.set(c.label, resolved);
      // Cost decay: LLM answers become tenant learned mappings immediately
      // - but only leaf answers; a demoted container is never learned.
      if (resolved.taxonomyNodeKey !== null) {
        await store.upsert(tenantId, {
          labelNorm,
          taxonomyNodeKey: resolved.taxonomyNodeKey,
          confidence: resolved.confidence,
          source: "llm",
          usageCount: 1,
        });
      }
    }
  }

  return labels.map(
    (label) =>
      results.get(label) ?? {
        label,
        labelNorm: normalizeLabel(label),
        taxonomyNodeKey: null,
        method: "unmapped" as const,
        confidence: 0,
      },
  );
}

function hit(
  label: string,
  labelNorm: string,
  m: LearnedMapping,
  method: MappingMethod,
): MappedLabel {
  return { label, labelNorm, taxonomyNodeKey: m.taxonomyNodeKey, method, confidence: m.confidence };
}

/** Human confirmation (review queue, M6.3): upgrades/creates the mapping. */
export async function confirmMapping(
  store: LearnedMappingsStore,
  tenantId: string,
  label: string,
  taxonomyNodeKey: string,
): Promise<void> {
  await store.upsert(tenantId, {
    labelNorm: normalizeLabel(label),
    taxonomyNodeKey,
    confidence: 1,
    source: "human",
    usageCount: 1,
  });
}
