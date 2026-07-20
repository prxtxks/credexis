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

/** Label normalization: the identity used for learning and lookup. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
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

export class AnthropicLabelClassifier implements LabelClassifier {
  private client: Anthropic;
  readonly model: string;

  constructor(cfg: { apiKey: string; model?: string; fetch?: typeof globalThis.fetch }) {
    this.model = cfg.model ?? "claude-haiku-4-5";
    this.client = new Anthropic({ apiKey: cfg.apiKey, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) });
  }

  async classifyLabels(
    labels: string[],
    statement: "PNL" | "BALANCE_SHEET",
  ): Promise<LabelClassification[]> {
    const prefix = statement === "PNL" ? "is." : "bs.";
    const nodes = TAXONOMY_V1.filter((n) => n.key.startsWith(prefix)).map((n) => n.key);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system:
        "You map financial statement line-item LABELS to a canonical chart of accounts. " +
        "You only ever see labels — never amounts. Return null when no node fits; " +
        "guessing is worse than null.",
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
          content: `Map each label to one node key (or null):\n${labels.map((l) => `- ${l}`).join("\n")}`,
        },
      ],
    });

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
      results.set(label, hit(label, labelNorm, tenantExact, "exact_tenant"));
      continue;
    }
    const tenantFuzzy = fuzzyFind(labelNorm, tenantPool);
    if (tenantFuzzy) {
      results.set(label, hit(label, labelNorm, tenantFuzzy, "fuzzy_tenant"));
      continue;
    }
    const globalExact = await store.findExact(null, labelNorm);
    if (globalExact) {
      results.set(label, hit(label, labelNorm, globalExact, "exact_global"));
      continue;
    }
    const globalFuzzy = fuzzyFind(labelNorm, globalPool);
    if (globalFuzzy) {
      results.set(label, hit(label, labelNorm, globalFuzzy, "fuzzy_global"));
      continue;
    }
    unresolved.push(label);
  }

  if (unresolved.length > 0 && classifier) {
    for (const c of await classifier.classifyLabels(unresolved, statement)) {
      const labelNorm = normalizeLabel(c.label);
      results.set(c.label, {
        label: c.label,
        labelNorm,
        taxonomyNodeKey: c.taxonomyNodeKey,
        method: c.taxonomyNodeKey === null ? "unmapped" : "llm",
        confidence: c.confidence,
      });
      // Cost decay: LLM answers become tenant learned mappings immediately.
      if (c.taxonomyNodeKey !== null) {
        await store.upsert(tenantId, {
          labelNorm,
          taxonomyNodeKey: c.taxonomyNodeKey,
          confidence: c.confidence,
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
