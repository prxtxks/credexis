/**
 * Extraction stage (M4.5/M5.5): logical documents → facts. The missing
 * middle of the product loop - after this stage a plain upload populates
 * the spread, the review queue, and the engine.
 *
 * Tax forms: registry-schema extraction through BOTH independent paths
 * (vendor + vision LLM) → consensus reconciler → confidence scorer →
 * facts (auto-accepted only on agreement above the bar; everything else
 * is `suggested` for review - Iron Law #6 posture).
 *
 * Statements: vendor layout grid → period binding → row typing →
 * taxonomy label mapping (labels only - the LLM never sees a number) →
 * structure validation → facts, ALWAYS `suggested` (statement mapping is
 * judgment; the review queue owns judgment).
 *
 * Every fact carries lineage (logical document, page, bbox where the
 * vendor gave one) and every path writes an extraction_runs row.
 */

import { slicePdfPages } from "./pdf.js";
import { matchDocumentEntities, pickIdentity } from "@credexis/extraction";
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
  /** Null for registry-only facts (derived tax lines - AGI, taxable income). */
  taxonomy_node_key: string | null;
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
  getDealEntities(dealId: string): Promise<{ id: string; kind: string; name: string }[]>;
  /** M11.6: identity match rows (worker-only insert; never facts). */
  insertDocumentIdentity(row: {
    tenant_id: string;
    logical_document_id: string;
    entity_id: string | null;
    extracted_name: string;
    source_page: number | null;
    method: string;
    score_bps: number;
    band: string;
  }): Promise<void>;
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

/** Honesty labels (M13.1): recognized so pages stop being relabelled as
 *  the nearest extractable form, and excluded from extraction on purpose.
 *  4626 = corporate AMT (no registry); NON_FORM = cover sheets, banners. */
const UNSUPPORTED_FAMILIES = new Set(["4626", "NON_FORM"]);

/* ── the stage ────────────────────────────────────────────────────────── */

export async function runExtractStage(
  deps: ExtractStageDeps,
  input: ExtractStageInput,
): Promise<ExtractStageResult> {
  const now = deps.now ?? Date.now;
  const result: ExtractStageResult = { factsInserted: 0, perDocument: [] };

  const entities = await deps.db.getDealEntities(input.dealId);
  const soleEntity = entities.length === 1 ? entities[0]!.id : null;

  // Skip only spans that are genuinely REDUNDANT - contained inside
  // another span of the same (family, year) that will itself be
  // extracted. Never skip a merely same-keyed span.
  //
  // This used to collapse every same-key span onto the earliest one, on
  // the premise that "adapters read the WHOLE file anyway". That premise
  // expired the next day when extraction started slicing to each span's
  // own pages (the `slicePdfPages` call below), and the comment was never
  // updated. The result was silent data loss: an 1120-S with interleaved
  // K-1s produces two 1120-S spans, only the first was ever sent to a
  // vendor, and the second was recorded as "extracted via its primary
  // span" - a coverage claim for pages nothing ever read. Containment
  // keeps the original intent (a duplicate span must not be billed
  // twice) without dropping disjoint fragments.
  const redundant = new Set<string>();
  const extractable = input.logicalDocuments.filter(
    (ld) =>
      !STATEMENT_FAMILIES.has(ld.formFamily) &&
      !UNSUPPORTED_FAMILIES.has(ld.formFamily) &&
      ld.formFamily !== "UNKNOWN",
  );
  for (const ld of extractable) {
    for (const other of extractable) {
      if (other.id === ld.id) continue;
      if (other.formFamily !== ld.formFamily || other.taxYear !== ld.taxYear) continue;
      const contains = other.pageStart <= ld.pageStart && other.pageEnd >= ld.pageEnd;
      const identical = other.pageStart === ld.pageStart && other.pageEnd === ld.pageEnd;
      // Identical ranges: keep exactly one (lowest id wins the tie).
      if (contains && (!identical || other.id < ld.id) && !redundant.has(other.id)) {
        redundant.add(ld.id);
        break;
      }
    }
  }

  for (const ld of input.logicalDocuments) {
    // Entity resolution: explicit assignment wins; a single-entity deal
    // defaults; multi-entity deals wait for the assignment UI (M6.5).
    const entityId = ld.entityId ?? soleEntity;
    if (!entityId) {
      result.perDocument.push({
        logicalDocumentId: ld.id,
        facts: 0,
        skipped: "no entity assigned (multi-entity deal - assign in M6.5 UI)",
      });
      continue;
    }

    try {
      if (UNSUPPORTED_FAMILIES.has(ld.formFamily)) {
        result.perDocument.push({
          logicalDocumentId: ld.id,
          facts: 0,
          skipped: `${ld.formFamily}: known but not extracted (no registry by design)`,
        });
      } else if (STATEMENT_FAMILIES.has(ld.formFamily)) {
        const n = await extractStatement(deps, input, ld, entityId, now);
        result.factsInserted += n;
        result.perDocument.push({ logicalDocumentId: ld.id, facts: n });
      } else if (ld.formFamily !== "UNKNOWN") {
        if (redundant.has(ld.id)) {
          result.perDocument.push({
            logicalDocumentId: ld.id,
            facts: 0,
            skipped: "duplicate span - its pages are covered by a wider span of the same form",
          });
          continue;
        }
        const n = await extractTaxForm(deps, input, ld, entityId, entities, now);
        result.factsInserted += n;
        result.perDocument.push({ logicalDocumentId: ld.id, facts: n });
      } else {
        result.perDocument.push({ logicalDocumentId: ld.id, facts: 0, skipped: "UNKNOWN family" });
      }
    } catch (e) {
      // One bad logical document must not lose the others' facts - and the
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
  entities: { id: string; kind: string; name: string }[],
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

  // ── M11.6 identity substage: the readers LOCATED the printed name
  // (identity TEXT fields - never facts); the match math is deterministic
  // (packages/shared). Advisory: a failure here must never fail
  // extraction. Auto-confirm stays OFF - even high bands are `suggested`.
  try {
    const identity = pickIdentity(p1?.candidates ?? [], p2?.candidates ?? []);
    if (identity) {
      const match = matchDocumentEntities(identity, entities);
      await deps.db.insertDocumentIdentity({
        tenant_id: input.tenantId,
        logical_document_id: ld.id,
        entity_id: match.entityId,
        extracted_name: identity.name,
        source_page: identity.page,
        method: identity.method,
        score_bps: match.scoreBps,
        band: match.band,
      });
    }
  } catch {
    // advisory substage - extraction result stands on its own
  }

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
  const spanLength = ld.pageEnd - ld.pageStart + 1;
  let outOfSpan = 0;
  for (const f of withValue) {
    const score = scored.get(f.fieldId);
    if (!score || score.decision === "reject") continue;
    const value = f.valueCents ?? f.path1?.cents ?? f.path2?.cents ?? null;
    if (value === null) continue; // both paths read "absent" - no fact (null-vs-zero)
    // OUT-OF-SPAN GUARD (M14.6). When the slice fell back to the whole
    // file, the vendor legitimately reads pages that belong to OTHER
    // spans - on the Golden Deal, four fragment spans of one return each
    // re-extracted page 1's tax line, and the spread SUMMED the same
    // printed $14,309 four times ($57,236 shown to the banker). A page
    // outside this span's range is proof the reading escaped the span:
    // drop it - the span that owns that page extracts it exactly once.
    // The same check bounds sliced reads (a vendor page past the slice
    // length is a hallucinated citation, equally untrustworthy).
    if (f.page !== null) {
      const inRange = slice.sliced
        ? f.page >= 1 && f.page <= spanLength
        : f.page >= ld.pageStart && f.page <= ld.pageEnd;
      if (!inRange) {
        outOfSpan += 1;
        continue;
      }
    }
    // Derived lines (AGI, taxable income) have no taxonomy placement by
    // design - they insert as registry-only facts (null taxonomy) so G4/G5
    // and the Tax Spread see them; statement aggregation never does.
    const taxonomyNodeKey = fieldById.get(f.fieldId)?.taxonomyNodeKey ?? null;
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
        // M14.6 honesty: a whole-file fallback and its dropped out-of-span
        // readings are visible in the run log, never silent.
        sliceFallback: !slice.sliced,
        outOfSpanDropped: outOfSpan,
      },
    ),
  );
  return inserted;
}

/* ── statements: grid → mapping → facts (always suggested) ────────────── */

/**
 * Wrapper (M18.3): a statement whose layout vendor dies must fail as ITS
 * OWN extract_statement run - during the Reducto 401 outage these
 * surfaced as generic extract_consensus failures, which pointed the
 * failure notice (and the on-call human) at the wrong stage. The failed
 * row keeps the span id, so the notice's Re-run action targets exactly
 * the span that needs the retry.
 */
async function extractStatement(
  deps: ExtractStageDeps,
  input: ExtractStageInput,
  ld: ExtractLogicalDocument,
  entityId: string,
  now: () => number,
): Promise<number> {
  const t0 = now();
  try {
    return await extractStatementInner(deps, input, ld, entityId, now);
  } catch (e) {
    await deps.db.insertExtractionRun(
      runRow(
        input,
        "extract_statement",
        deps.statementLayout?.name ?? "extract-stage",
        null,
        null,
        "failed",
        (e as Error).message,
        0n,
        now() - t0,
        { logicalDocumentId: ld.id, formFamily: ld.formFamily },
      ),
    );
    return 0;
  }
}

async function extractStatementInner(
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
    // abort the document: retry with learned mappings only - unmapped
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
        // M14.7: the value cell's geometry - the green mark on statement
        // facts, same lineage contract as the tax path.
        source_bbox: draft.bbox,
        method: "vendor",
        confidence: mapping?.confidence ?? 0.5,
        // Statement mapping is judgment - the review queue owns judgment.
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
        // M18.4: a served-by-fallback layout is visible in the run log -
        // duck-typed so the stage stays adapter-agnostic.
        ...((deps.statementLayout as { lastFailover?: unknown }).lastFailover
          ? {
              layoutFailover: (deps.statementLayout as { lastFailover?: unknown }).lastFailover,
            }
          : {}),
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
