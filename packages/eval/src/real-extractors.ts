/**
 * Real extractors for the vendor bake-off (M3.4). Each wraps the EXACT
 * production extraction stage (runExtractStage) around an in-memory
 * capture port — the bake-off grades the code that ships, not a replica.
 *
 * Rows:
 *   reducto    — Path 1 only, Reducto for every family + statement grids
 *   azure      — Path 1 only, Azure prebuilt-tax, 1040-family docs only
 *   claude     — Path 2 only (vision LLM), tax forms only
 *   consensus  — THE SYSTEM: both paths + reconciler + confidence scorer,
 *                statement chain with LLM label mapping
 *
 * Single-path rows surface raw vendor accuracy: every produced value is
 * treated as auto_accept (there is no reconciler to demote it), which is
 * exactly what "trusting this vendor alone" would mean in production.
 * LIVE CALLS — gated behind RUN_LIVE_VENDOR_TESTS=1 in the runner.
 */

import { readFile } from "node:fs/promises";
import {
  AnthropicLabelClassifier,
  AnthropicVisionAdapter,
  AzureDocumentIntelligenceAdapter,
  InMemoryMappingsStore,
  normalizeLabel,
  ReductoAdapter,
  type ExtractorAdapter,
} from "@credexis/extraction";
import {
  runExtractStage,
  type ExtractDbPort,
  type ExtractionRunInsert,
  type FactInsert,
} from "@credexis/pipeline";
import { LEARNED_MAPPINGS_SEED } from "@credexis/schema";

/**
 * Per-doc mappings store preloaded with the SHIPPED global seed. The seed
 * is product code (human-verified, versioned in git) — production always
 * has it, so the eval measures the system that actually ships. What stays
 * cold per doc: LLM write-backs — no accumulated vocabulary leaks from one
 * eval doc into the next, and no eval answer ever feeds the seed.
 */
async function seededStore(): Promise<InMemoryMappingsStore> {
  const store = new InMemoryMappingsStore();
  for (const m of LEARNED_MAPPINGS_SEED) {
    await store.upsert(null, {
      labelNorm: normalizeLabel(m.label),
      taxonomyNodeKey: m.node,
      confidence: 0.95,
      source: "human",
      usageCount: 1,
    });
  }
  return store;
}
import type { EvalDocument, EvalExtractor, ExtractedField, ExtractionResult } from "./types.js";

const A1040 = new Set(["1040", "1040_SCH_1", "1040_SCH_C", "1040_SCH_E", "1040_SCH_F", "W2"]);
const STATEMENTS = new Set(["PNL", "BALANCE_SHEET", "DEBT_SCHEDULE"]);

/**
 * Period labels: ground truth may carry a display suffix
 * ("2025-05 (as-of 5/31/25)"); the chain emits the canonical stem. Both
 * sides are canonicalized identically before comparison — formatting
 * normalization only, never a value change (Iron Law #9 untouched).
 */
export function canonPeriod(label: string): string {
  const stripped = label.replace(/\s*\(.*\)\s*$/, "").trim();
  // Point-in-time labels compare by month: the chain emits
  // "As of 2025-05-31", hand labels often say "2025-05" — same instant,
  // different spelling. Both sides canonicalize identically.
  const asOf = /^As of (\d{4})-(\d{2})-\d{2}$/.exec(stripped);
  if (asOf) return `${asOf[1]}-${asOf[2]}`;
  return stripped;
}

interface CaptureResult {
  facts: (FactInsert & { periodLabel: string })[];
  costMicroUsd: bigint;
}

function capturePort(entityKind: string): { port: ExtractDbPort; result: CaptureResult } {
  const periods = new Map<string, string>(); // id → label
  const result: CaptureResult = { facts: [], costMicroUsd: 0n };
  const port: ExtractDbPort = {
    getDealEntities: () =>
      Promise.resolve([{ id: "eval-entity", kind: entityKind, name: "Eval Entity" }]),
    insertDocumentIdentity: () => Promise.resolve(), // scored separately, not in field accuracy
    findOrCreatePeriod: (row) => {
      const id = `period:${row.label}`;
      periods.set(id, row.label);
      return Promise.resolve(id);
    },
    insertFacts: (rows) => {
      for (const r of rows) {
        result.facts.push({ ...r, periodLabel: periods.get(r.period_id) ?? r.period_id });
      }
      return Promise.resolve(rows.length);
    },
    insertExtractionRun: (row: ExtractionRunInsert) => {
      result.costMicroUsd += row.costMicroUsd;
      return Promise.resolve();
    },
  };
  return { port, result };
}

export interface VendorEnv {
  REDUCTO_API_KEY?: string | undefined;
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?: string | undefined;
  AZURE_DOCUMENT_INTELLIGENCE_KEY?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
}

interface RowSpec {
  name: string;
  supports: (family: string) => boolean;
  path1ForFamily: (family: string) => ExtractorAdapter | null;
  path2: ExtractorAdapter | null;
  statementLayout: ExtractorAdapter | null;
  labelClassifier: AnthropicLabelClassifier | null;
  /** Raw-vendor rows: everything produced counts as auto-accepted. */
  forceAutoAccept: boolean;
}

function toExtractor(spec: RowSpec): EvalExtractor {
  return {
    name: spec.name,
    version: "bake-off-1",
    async extract(doc: EvalDocument): Promise<ExtractionResult> {
      const gt = doc.groundTruth;
      if (!doc.pdfPath) throw new Error(`no local PDF for ${gt.id}`);
      if (!spec.supports(gt.form_family)) {
        return { fields: [], cost_micro_usd: 0n }; // unsupported → skipped row
      }
      const bytes = new Uint8Array(await readFile(doc.pdfPath));
      const { port, result } = capturePort(gt.entity);

      await runExtractStage(
        {
          db: port,
          path1ForFamily: spec.path1ForFamily,
          path2: spec.path2,
          statementLayout: spec.statementLayout,
          labelClassifier: spec.labelClassifier,
          mappingsStore: await seededStore(), // shipped seed + per-doc cold LLM write-backs
        },
        {
          tenantId: "eval-tenant",
          dealId: "eval-deal",
          documentId: gt.id,
          bytes,
          mimeType: "application/pdf",
          logicalDocuments: [
            {
              id: `eval-ld-${gt.id}`,
              formFamily: gt.form_family,
              taxYear: gt.tax_year,
              // Bound the span by the labeled pages — the eval analogue of
              // what the splitter does in production. This is verified
              // knowledge of where the form IS, never of its values.
              pageStart: Math.min(...gt.fields.map((f) => f.page)),
              pageEnd: Math.max(...gt.fields.map((f) => f.page)),
              entityId: "eval-entity",
            },
          ],
        },
      );

      const fields: ExtractedField[] = result.facts.map((f) => {
        const field: ExtractedField = {
          period: canonPeriod(f.periodLabel),
          value_cents: BigInt(f.value_cents),
          outcome:
            spec.forceAutoAccept || f.status === "accepted"
              ? ("auto_accept" as const)
              : ("review" as const),
        };
        // Every fact keys into registry OR taxonomy (the facts CHECK mirrors
        // this); registry id wins — registry-only facts have no taxonomy.
        if (f.registry_field_id !== null) field.registry_field_id = f.registry_field_id;
        else if (f.taxonomy_node_key !== null) field.taxonomy_node = f.taxonomy_node_key;
        return field;
      });
      return { fields, cost_micro_usd: result.costMicroUsd };
    },
  };
}

export function buildRealExtractors(env: VendorEnv): Record<string, EvalExtractor> {
  const reducto = env.REDUCTO_API_KEY ? new ReductoAdapter({ apiKey: env.REDUCTO_API_KEY }) : null;
  const azure =
    env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && env.AZURE_DOCUMENT_INTELLIGENCE_KEY
      ? new AzureDocumentIntelligenceAdapter({
          endpoint: env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
          apiKey: env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
        })
      : null;
  // Evals are latency-tolerant → Message Batches API (50% off) unless
  // explicitly disabled. The live pipeline never batches.
  const batch = process.env["EVAL_NO_BATCH"] === "1" ? null : { pollIntervalMs: 5_000 };
  const claude = env.ANTHROPIC_API_KEY
    ? new AnthropicVisionAdapter({ apiKey: env.ANTHROPIC_API_KEY, batch })
    : null;
  const labelClassifier = env.ANTHROPIC_API_KEY
    ? new AnthropicLabelClassifier({ apiKey: env.ANTHROPIC_API_KEY, batch })
    : null;

  const rows: Record<string, EvalExtractor> = {};
  if (reducto) {
    rows["reducto"] = toExtractor({
      name: "reducto-solo",
      supports: () => true,
      path1ForFamily: () => reducto,
      path2: null,
      statementLayout: reducto,
      labelClassifier, // statement labels still need mapping to be gradeable
      forceAutoAccept: true,
    });
  }
  if (azure) {
    rows["azure"] = toExtractor({
      name: "azure-solo",
      supports: (f) => A1040.has(f),
      path1ForFamily: (f) => (A1040.has(f) ? azure : null),
      path2: null,
      statementLayout: null,
      labelClassifier: null,
      forceAutoAccept: true,
    });
  }
  if (claude) {
    rows["claude"] = toExtractor({
      name: "claude-solo",
      supports: (f) => !STATEMENTS.has(f),
      path1ForFamily: () => null,
      path2: claude,
      statementLayout: null,
      labelClassifier: null,
      forceAutoAccept: true,
    });
  }
  if (reducto && claude) {
    rows["consensus"] = toExtractor({
      name: "consensus-system",
      supports: () => true,
      // ADR-0002: Reducto is Path 1 for ALL families — Azure prebuilt-tax
      // failed on real CPA bundles and its free tier rate-limits; it stays
      // a measured solo row until re-evaluated on a paid tier.
      path1ForFamily: () => reducto,
      path2: claude,
      statementLayout: reducto,
      labelClassifier,
      forceAutoAccept: false, // the scorer's outcomes are the point
    });
  }
  return rows;
}
