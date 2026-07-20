/**
 * Extraction stage (M4.5/M5.5): logical documents → facts. The missing
 * middle of the product loop — after this stage a plain upload populates
 * the spread, the review queue, and the engine.
 *
 * Tax forms: registry-schema extraction through BOTH independent paths
 * (vendor + vision LLM) → consensus reconciler → confidence scorer →
 * facts (auto-accepted only on agreement above the bar; everything else
 * is `suggested` for review — Iron Law #6 posture).
 *
 * Statements: vendor layout grid → period binding → row typing →
 * taxonomy label mapping (labels only — the LLM never sees a number) →
 * structure validation → facts, ALWAYS `suggested` (statement mapping is
 * judgment; the review queue owns judgment).
 *
 * Every fact carries lineage (logical document, page, bbox where the
 * vendor gave one) and every path writes an extraction_runs row.
 */

import { slicePdfPages } from "./pdf.js";
import {
  getRegistryEntry,
  reconcile,
  runExtractionPath,
  pagesToGrids,
  bindPeriods,
  typeRows,
  mapLabels,
  validateStructure,
  type DocumentInput,
  type ExtractorAdapter,
  type LabelClassifier,
  type LearnedMappingsStore,
  type PathExtraction,
} from "@credexis/extraction";
import { scoreFields, type FieldSignals } from "@credexis/engine";
import type { FormFamily } from "@credexis/schema";
import type { ExtractionRunInsert } from "./ports.js";
import { PIPELINE_VERSION } from "./ingest.js";

/* ── ports ────────────────────────────────────────────────────────────── */

export interface FactInsert {
  tenant_id: string;
  deal_id: string;
  entity_id: string;
  period_id: string;
  taxonomy_node_key: string;
  registry_field_id: string | null;
  value_cents: string;
  source_logical_document_id: string;
  source_page: number | null;
  source_bbox: { x: number; y: number; w: number; h: number } | null;
  method: "vendor" | "llm" | "consensus";
  confidence: number;
  status: "suggested" | "accepted";
}

export interface ExtractDbPort {
  /** Entities of the deal (sole entity = default assignment). */
  getDealEntities(dealId: string): Promise<{ id: string; kind: string }[]>;
  findOrCreatePeriod(row: {
    tenantId: string;
    entityId: string;
    kind: "fiscal_year" | "interim" | "ttm";
    label: string;
    startDate: string;
    endDate: string;
  }): Promise<string>;
  insertFacts(rows: FactInsert[]): Promise<number>;
  insertExtractionRun(row: ExtractionRunInsert): Promise<void>;
}

export interface ExtractLogicalDocument {
  id: string;
  formFamily: string;
  taxYear: number | null;
  pageStart: number;
  pageEnd: number;
  entityId: string | null;
}

export interface ExtractStageDeps {
  db: ExtractDbPort;
  /** Path 1 vendor per family (Blueprint: Azure for 1040-family, Reducto otherwise). */
  path1ForFamily: (family: string) => ExtractorAdapter | null;
  /** Path 2 vision LLM. */
  path2: ExtractorAdapter | null;
  /** Layout vendor for statement grids. */
  statementLayout: ExtractorAdapter | null;
  labelClassifier: LabelClassifier | null;
  mappingsStore: LearnedMappingsStore;
  now?: () => number;
}

export interface ExtractStageInput {
  tenantId: string;
  dealId: string;
  documentId: string;
  bytes: Uint8Array;
  mimeType: DocumentInput["mimeType"];
  logicalDocuments: ExtractLogicalDocument[];
}

export interface ExtractStageResult {
  factsInserted: number;
  perDocument: { logicalDocumentId: string; facts: number; skipped?: string }[];
}

const STATEMENT_FAMILIES = new Set(["PNL", "BALANCE_SHEET", "DEBT_SCHEDULE"]);

/* ── the stage ────────────────────────────────────────────────────────── */

export async function runExtractStage(
  deps: ExtractStageDeps,
  input: ExtractStageInput,
): Promise<ExtractStageResult> {
  const now = deps.now ?? Date.now;
  const result: ExtractStageResult = { factsInserted: 0, perDocument: [] };

  const entities = await deps.db.getDealEntities(input.dealId);
  const soleEntity = entities.length === 1 ? entities[0]!.id : null;

  // Interleaved schedules fragment one form into several spans; adapters
  // read the WHOLE file anyway, so extract once per (family, year) via the
  // primary (earliest) span — 4 fragments must not mean 4 vendor bills.
  const primaryByKey = new Map<string, string>();
  for (const ld of input.logicalDocuments) {
    if (STATEMENT_FAMILIES.has(ld.formFamily) || ld.formFamily === "UNKNOWN") continue;
    const key = `${ld.formFamily}|${ld.taxYear}`;
    const current = primaryByKey.get(key);
    const currentStart =
      input.logicalDocuments.find((x) => x.id === current)?.pageStart ?? Infinity;
    if (!current || ld.pageStart < currentStart) primaryByKey.set(key, ld.id);
  }

  for (const ld of input.logicalDocuments) {
    // Entity resolution: explicit assignment wins; a single-entity deal
    // defaults; multi-entity deals wait for the assignment UI (M6.5).
    const entityId = ld.entityId ?? soleEntity;
    if (!entityId) {
      result.perDocument.push({
        logicalDocumentId: ld.id,
        facts: 0,
        skipped: "no entity assigned (multi-entity deal — assign in M6.5 UI)",
      });
      continue;
    }

    try {
      if (STATEMENT_FAMILIES.has(ld.formFamily)) {
        const n = await extractStatement(deps, input, ld, entityId, now);
        result.factsInserted += n;
        result.perDocument.push({ logicalDocumentId: ld.id, facts: n });
      } else if (ld.formFamily !== "UNKNOWN") {
        if (primaryByKey.get(`${ld.formFamily}|${ld.taxYear}`) !== ld.id) {
          result.perDocument.push({
            logicalDocumentId: ld.id,
            facts: 0,
            skipped: "fragment of a form extracted via its primary span",
          });
          continue;
        }
        const n = await extractTaxForm(deps, input, ld, entityId, now);
        result.factsInserted += n;
        result.perDocument.push({ logicalDocumentId: ld.id, facts: n });
      } else {
        result.perDocument.push({ logicalDocumentId: ld.id, facts: 0, skipped: "UNKNOWN family" });
      }
    } catch (e) {
      // One bad logical document must not lose the others' facts — and the
      // failure recorder itself is best-effort (a dead DB must not cascade).
      try {
        await deps.db.insertExtractionRun(
          runRow(
            input,
            "extract_consensus",
            "extract-stage",
            null,
            null,
            "failed",
            (e as Error).message,
            0n,
            0,
          ),
        );
      } catch {
        /* recorded via the task log instead */
      }
      result.perDocument.push({
        logicalDocumentId: ld.id,
        facts: 0,
        skipped: `error: ${(e as Error).message.slice(0, 120)}`,
      });
    }
  }

  return result;
}

/* ── tax forms: dual path + consensus + scorer ────────────────────────── */

async function extractTaxForm(
  deps: ExtractStageDeps,
  input: ExtractStageInput,
  ld: ExtractLogicalDocument,
  entityId: string,
  now: () => number,
): Promise<number> {
  if (ld.taxYear === null) {
    await deps.db.insertExtractionRun(
      runRow(
        input,
        "extract_consensus",
        "extract-stage",
        null,
        null,
        "failed",
        `no tax year on ${ld.formFamily} logical doc`,
        0n,
        0,
      ),
    );
    return 0;
  }
  const entry = getRegistryEntry(ld.formFamily as FormFamily, ld.taxYear);
  if (!entry) {
    await deps.db.insertExtractionRun(
      runRow(
        input,
        "extract_consensus",
        "extract-stage",
        null,
        null,
        "failed",
        `no registry entry for ${ld.formFamily} ${ld.taxYear}`,
        0n,
        0,
      ),
    );
    return 0;
  }

  // Adapters see ONLY this logical document's pages (bake-off finding:
  // whole bundles bury the form and inflate cost). Sliced pages are
  // 1-based relative to the slice = logical-relative already.
  const slice =
    input.mimeType === "application/pdf"
      ? await slicePdfPages(input.bytes, ld.pageStart, ld.pageEnd)
      : { bytes: input.bytes, pageCount: null, sliced: false };
  const doc: DocumentInput = { bytes: slice.bytes, mimeType: input.mimeType };
  const path1Adapter = deps.path1ForFamily(ld.formFamily);

  const settle = async (
    stage: "path1_vendor" | "path2_llm",
    adapter: ExtractorAdapter | null,
  ): Promise<PathExtraction | null> => {
    if (!adapter) return null;
    const t0 = now();
    try {
      const p = await runExtractionPath(stage, adapter, doc, entry);
      await deps.db.insertExtractionRun(
        runRow(
          input,
          stage === "path1_vendor" ? "extract_path1" : "extract_path2",
          p.run.vendor,
          p.run.model ?? null,
          p.run.pageCount,
          "succeeded",
          null,
          p.run.costMicroUsd,
          now() - t0,
        ),
      );
      return p;
    } catch (e) {
      await deps.db.insertExtractionRun(
        runRow(
          input,
          stage === "path1_vendor" ? "extract_path1" : "extract_path2",
          "unknown",
          null,
          null,
          "failed",
          (e as Error).message,
          0n,
          now() - t0,
        ),
      );
      return null; // a failed path must not lose the other's work
    }
  };

  const [p1, p2] = await Promise.all([
    settle("path1_vendor", path1Adapter),
    settle("path2_llm", deps.path2),
  ]);
  if (!p1 && !p2) return 0;

  const reconciled = reconcile(p1?.candidates ?? [], p2?.candidates ?? [], entry);

  // Confidence scorer decides auto-accept vs review (M6.2). A field
  // implicated by a violated registry relation can never auto-accept.
  const withValue = reconciled.fields.filter((f) => f.path1 !== null || f.path2 !== null);
  const signals: FieldSignals[] = withValue.map((f) => ({
    factId: f.fieldId,
    path1Cents: f.path1?.cents ?? null,
    path2Cents: f.path2?.cents ?? null,
    path1Confidence: f.path1?.confidence ?? 0,
    path2Confidence: f.path2?.confidence ?? 0,
    gateBlocked: f.implicatedByRelation,
  }));
  const scored = new Map(scoreFields(signals).map((s) => [s.factId, s]));

  const periodId = await deps.db.findOrCreatePeriod({
    tenantId: input.tenantId,
    entityId,
    kind: "fiscal_year",
    label: `FY${ld.taxYear}`,
    startDate: `${ld.taxYear}-01-01`,
    endDate: `${ld.taxYear}-12-31`,
  });

  const fieldById = new Map(entry.fields.map((f) => [f.fieldId, f]));
  const rows: FactInsert[] = [];
  for (const f of withValue) {
    const score = scored.get(f.fieldId);
    if (!score || score.decision === "reject") continue;
    const value = f.valueCents ?? f.path1?.cents ?? f.path2?.cents ?? null;
    if (value === null) continue; // both paths read "absent" — no fact (null-vs-zero)
    const taxonomyNodeKey = fieldById.get(f.fieldId)?.taxonomyNodeKey ?? null;
    if (!taxonomyNodeKey) continue; // registry rows without placement feed G4/G5 later
    rows.push({
      tenant_id: input.tenantId,
      deal_id: input.dealId,
      entity_id: entityId,
      period_id: periodId,
      taxonomy_node_key: taxonomyNodeKey,
      registry_field_id: f.fieldId,
      value_cents: value.toString(),
      source_logical_document_id: ld.id,
      // Adapter pages are physical (whole file); facts store logical-relative.
      source_page: f.page !== null ? (slice.sliced ? f.page : f.page - ld.pageStart + 1) : null,
      source_bbox: f.bbox,
      method: f.outcome === "consensus" ? "consensus" : f.path1 ? "vendor" : "llm",
      confidence: score.confidence,
      status:
        f.outcome === "consensus" && score.decision === "auto_accept" ? "accepted" : "suggested",
    });
  }

  const inserted = rows.length > 0 ? await deps.db.insertFacts(rows) : 0;
  await deps.db.insertExtractionRun(
    runRow(
      input,
      "extract_consensus",
      "consensus-reconciler",
      null,
      null,
      "succeeded",
      null,
      0n,
      0,
      {
        logicalDocumentId: ld.id,
        formFamily: ld.formFamily,
        taxYear: ld.taxYear,
        fields: reconciled.fields.length,
        facts: inserted,
        autoAccepted: rows.filter((r) => r.status === "accepted").length,
        relationViolations: reconciled.relationChecks.filter((c) => c.status === "violated").length,
      },
    ),
  );
  return inserted;
}

/* ── statements: grid → mapping → facts (always suggested) ────────────── */

async function extractStatement(
  deps: ExtractStageDeps,
  input: ExtractStageInput,
  ld: ExtractLogicalDocument,
  entityId: string,
  now: () => number,
): Promise<number> {
  if (!deps.statementLayout) {
    await deps.db.insertExtractionRun(
      runRow(
        input,
        "extract_statement",
        "extract-stage",
        null,
        null,
        "failed",
        "no layout vendor configured",
        0n,
        0,
      ),
    );
    return 0;
  }
  const statement = ld.formFamily === "PNL" ? ("PNL" as const) : ("BALANCE_SHEET" as const);
  const t0 = now();
  // Same slice discipline as the tax path: the layout vendor parses only
  // this statement's pages (slice pages are logical-relative 1..N).
  const slice =
    input.mimeType === "application/pdf"
      ? await slicePdfPages(input.bytes, ld.pageStart, ld.pageEnd)
      : { bytes: input.bytes, pageCount: null, sliced: false };
  const layout = await deps.statementLayout.parseLayout({
    bytes: slice.bytes,
    mimeType: input.mimeType,
  });
  const pages = slice.sliced
    ? layout.pages
    : layout.pages.filter((p) => p.page >= ld.pageStart && p.page <= ld.pageEnd);
  const grids = pagesToGrids(pages);

  let inserted = 0;
  let unmapped = 0;
  for (const grid of grids) {
    const binding = bindPeriods(grid, pages);
    const typed = typeRows(grid);
    const labels = [...new Set(typed.map((r) => r.row.label).filter((l) => l.trim() !== ""))];
    // A dead classifier (rate limit, credits, outage) must DEGRADE, not
    // abort the document: retry with learned mappings only — unmapped
    // labels route to review instead of losing the whole statement.
    let mapped;
    try {
      mapped = await mapLabels(
        labels,
        statement,
        input.tenantId,
        deps.mappingsStore,
        deps.labelClassifier,
      );
    } catch {
      mapped = await mapLabels(labels, statement, input.tenantId, deps.mappingsStore, null);
    }
    const mappedByLabel = new Map(mapped.map((m) => [m.label, m]));
    const validated = validateStructure(typed, binding, mappedByLabel, {
      statement,
      page: grid.page,
    });
    unmapped += validated.unmappedLabels.length;

    const periodIds = new Map<string, string>();
    for (const [, period] of binding.byColumn) {
      if (!period || periodIds.has(period.label)) continue;
      periodIds.set(
        period.label,
        await deps.db.findOrCreatePeriod({
          tenantId: input.tenantId,
          entityId,
          kind: period.kind,
          label: period.label,
          startDate: period.startDate,
          endDate: period.endDate,
        }),
      );
    }

    const rows: FactInsert[] = [];
    for (const draft of validated.facts) {
      const periodId = periodIds.get(draft.periodLabel);
      if (!periodId) continue;
      const mapping = mappedByLabel.get(draft.sourceLabel);
      rows.push({
        tenant_id: input.tenantId,
        deal_id: input.dealId,
        entity_id: entityId,
        period_id: periodId,
        taxonomy_node_key: draft.taxonomyNodeKey,
        registry_field_id: null,
        value_cents: draft.valueCents.toString(),
        source_logical_document_id: ld.id,
        source_page: slice.sliced ? draft.page : draft.page - ld.pageStart + 1,
        source_bbox: null, // grid-level geometry joins with the bake-off vendor work
        method: "vendor",
        confidence: mapping?.confidence ?? 0.5,
        // Statement mapping is judgment — the review queue owns judgment.
        status: "suggested",
      });
    }
    inserted += rows.length > 0 ? await deps.db.insertFacts(rows) : 0;
  }

  await deps.db.insertExtractionRun(
    runRow(
      input,
      "extract_statement",
      "statement-chain",
      null,
      pages.length,
      "succeeded",
      null,
      0n,
      now() - t0,
      {
        logicalDocumentId: ld.id,
        statement,
        grids: grids.length,
        facts: inserted,
        unmappedLabels: unmapped,
      },
    ),
  );
  return inserted;
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function runRow(
  input: ExtractStageInput,
  stage: string,
  extractorName: string,
  model: string | null,
  pageCount: number | null,
  status: "succeeded" | "failed",
  error: string | null,
  costMicroUsd: bigint,
  durationMs: number,
  metadata: Record<string, unknown> | null = null,
): ExtractionRunInsert {
  return {
    tenantId: input.tenantId,
    dealId: input.dealId,
    documentId: input.documentId,
    stage: stage as ExtractionRunInsert["stage"],
    extractorName,
    extractorVersion: PIPELINE_VERSION,
    model,
    pageCount,
    costMicroUsd,
    status,
    error,
    metadata,
    durationMs,
  };
}
