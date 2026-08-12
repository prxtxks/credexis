import { describe, expect, it } from "vitest";
import type {
  DocumentInput,
  ExtractorAdapter,
  FieldCandidate,
  FieldRequest,
  LayoutParseResult,
} from "@credexis/extraction";
import { InMemoryMappingsStore } from "@credexis/extraction";
import { runExtractStage, type ExtractDbPort, type FactInsert } from "./extract-stage.js";
import type { ExtractionRunInsert } from "./ports.js";

/* ── fakes ────────────────────────────────────────────────────────────── */

class FakeDb implements ExtractDbPort {
  facts: FactInsert[] = [];
  runs: ExtractionRunInsert[] = [];
  periods = new Map<string, string>();
  entities: { id: string; kind: string }[] = [{ id: "ent-1", kind: "target" }];

  async getDealEntities(): Promise<{ id: string; kind: string }[]> {
    return this.entities;
  }
  async findOrCreatePeriod(row: { label: string }): Promise<string> {
    if (!this.periods.has(row.label)) this.periods.set(row.label, `per-${this.periods.size + 1}`);
    return this.periods.get(row.label)!;
  }
  async insertFacts(rows: FactInsert[]): Promise<number> {
    this.facts.push(...rows);
    return rows.length;
  }
  async insertExtractionRun(row: ExtractionRunInsert): Promise<void> {
    this.runs.push(row);
  }
}

const RUN = { vendor: "fake", vendorVersion: "1", pageCount: 1, costMicroUsd: 1000n };

function adapterReturning(candidates: FieldCandidate[]): ExtractorAdapter {
  return {
    name: "fake",
    async parseLayout(): Promise<LayoutParseResult> {
      throw new Error("not a layout adapter");
    },
    async extractFields(_doc: DocumentInput, _fields: FieldRequest[]) {
      return { candidates, run: { ...RUN } };
    },
  } as unknown as ExtractorAdapter;
}

const cand = (fieldId: string, value: string, confidence = 0.95): FieldCandidate => ({
  fieldId,
  valueText: value,
  page: 2,
  bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.02 },
  confidence,
});

const INPUT = {
  tenantId: "t-1",
  dealId: "d-1",
  documentId: "doc-1",
  bytes: new Uint8Array([1]),
  mimeType: "application/pdf" as const,
};

const LD_1120S = {
  id: "ld-1",
  formFamily: "1120S",
  taxYear: 2023,
  pageStart: 1,
  pageEnd: 5,
  entityId: null,
};

const baseDeps = (over: Partial<Parameters<typeof runExtractStage>[0]>) => ({
  db: new FakeDb(),
  path1ForFamily: () => null,
  path2: null,
  statementLayout: null,
  labelClassifier: null,
  mappingsStore: new InMemoryMappingsStore(),
  ...over,
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe("runExtractStage - tax forms", () => {
  it("agreeing paths → consensus fact, auto-accepted, with vendor geometry", async () => {
    const db = new FakeDb();
    const deps = baseDeps({
      db,
      path1ForFamily: () => adapterReturning([cand("f1120s.line1c", "121,125.")]),
      path2: adapterReturning([cand("f1120s.line1c", "121125")]),
    });
    const result = await runExtractStage(deps, { ...INPUT, logicalDocuments: [LD_1120S] });

    expect(result.factsInserted).toBe(1);
    const fact = db.facts[0]!;
    expect(fact).toMatchObject({
      registry_field_id: "f1120s.line1c",
      value_cents: "12112500",
      method: "consensus",
      status: "accepted",
      entity_id: "ent-1", // sole-entity default
      source_page: 2, // physical page 2, logical starts at 1
    });
    expect(fact.source_bbox).not.toBeNull();
    expect(db.periods.has("FY2023")).toBe(true);
    // runs: path1 + path2 + consensus summary
    expect(db.runs.map((r) => r.stage)).toEqual([
      "extract_path1",
      "extract_path2",
      "extract_consensus",
    ]);
  });

  it("disagreeing paths → suggested for review, never auto-accepted", async () => {
    const db = new FakeDb();
    const deps = baseDeps({
      db,
      path1ForFamily: () => adapterReturning([cand("f1120s.line1c", "121,125.")]),
      path2: adapterReturning([cand("f1120s.line1c", "121,215.")]), // transposed
    });
    await runExtractStage(deps, { ...INPUT, logicalDocuments: [LD_1120S] });
    expect(db.facts[0]!.status).toBe("suggested");
    expect(db.facts[0]!.method).not.toBe("consensus");
  });

  it("one path failing keeps the other's work as single-source review", async () => {
    const db = new FakeDb();
    const failing: ExtractorAdapter = {
      name: "boom",
      async parseLayout() {
        throw new Error("x");
      },
      async extractFields() {
        throw new Error("vendor 500");
      },
    } as unknown as ExtractorAdapter;
    const deps = baseDeps({
      db,
      path1ForFamily: () => failing,
      path2: adapterReturning([cand("f1120s.line1c", "121125")]),
    });
    const result = await runExtractStage(deps, { ...INPUT, logicalDocuments: [LD_1120S] });
    expect(result.factsInserted).toBe(1);
    expect(db.facts[0]).toMatchObject({ method: "llm", status: "suggested" });
    expect(db.runs.find((r) => r.stage === "extract_path1")!.status).toBe("failed");
  });

  it("derived registry lines without taxonomy placement land as registry-only facts", async () => {
    // f1040.line11 (AGI) deliberately has no taxonomyNodeKey in the registry
    // (ADR-0002: derived lines never aggregate). It must still become a fact -
    // keyed by registry_field_id alone - for G4/G5 and the Tax Spread.
    const agree = [
      cand("f1040.line9", "100,000."),
      cand("f1040.line10", "5,000."),
      cand("f1040.line11", "95,000."),
    ];
    const db = new FakeDb();
    const deps = baseDeps({
      db,
      path1ForFamily: () => adapterReturning(agree),
      path2: adapterReturning(agree),
    });
    const result = await runExtractStage(deps, {
      ...INPUT,
      logicalDocuments: [
        {
          id: "ld-1040",
          formFamily: "1040",
          taxYear: 2023,
          pageStart: 1,
          pageEnd: 2,
          entityId: null,
        },
      ],
    });

    expect(result.factsInserted).toBe(3); // AGI is NOT silently dropped
    const agi = db.facts.find((f) => f.registry_field_id === "f1040.line11");
    expect(agi).toMatchObject({
      taxonomy_node_key: null,
      value_cents: "9500000",
      method: "consensus",
      status: "accepted",
    });
    expect(agi!.source_bbox).not.toBeNull(); // lineage intact (Iron Law #5)
    // Mapped lines keep their taxonomy placement alongside the registry id.
    const total = db.facts.find((f) => f.registry_field_id === "f1040.line9");
    expect(total!.taxonomy_node_key).toBe("pcf.income.total");
  });

  it("multi-entity deal without assignment skips (never guesses the entity)", async () => {
    const db = new FakeDb();
    db.entities = [
      { id: "ent-1", kind: "target" },
      { id: "ent-2", kind: "guarantor" },
    ];
    const deps = baseDeps({
      db,
      path1ForFamily: () => adapterReturning([cand("f1120s.line1c", "1")]),
    });
    const result = await runExtractStage(deps, { ...INPUT, logicalDocuments: [LD_1120S] });
    expect(result.factsInserted).toBe(0);
    expect(result.perDocument[0]!.skipped).toMatch(/no entity/);
  });

  it("unknown family and missing registry year are recorded, not guessed", async () => {
    const db = new FakeDb();
    const deps = baseDeps({
      db,
      path1ForFamily: () => adapterReturning([cand("f1120s.line1c", "1")]),
    });
    const result = await runExtractStage(deps, {
      ...INPUT,
      logicalDocuments: [
        { ...LD_1120S, id: "ld-u", formFamily: "UNKNOWN" },
        { ...LD_1120S, id: "ld-y", taxYear: 1999 },
      ],
    });
    expect(result.factsInserted).toBe(0);
    expect(result.perDocument[0]!.skipped).toMatch(/UNKNOWN/);
    expect(
      db.runs.some((r) => r.status === "failed" && /no registry entry/.test(r.error ?? "")),
    ).toBe(true);
  });
});

describe("runExtractStage - statements", () => {
  it("maps a layout grid into suggested facts through the taxonomy chain", async () => {
    const db = new FakeDb();
    const layout: LayoutParseResult = {
      pages: [
        {
          page: 1,
          textBlocks: [],
          tables: [
            {
              page: 1,
              bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 },
              cells: [
                { rowIndex: 0, colIndex: 0, text: "", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.02 } },
                {
                  rowIndex: 0,
                  colIndex: 1,
                  text: "FY2024",
                  bbox: { x: 0.5, y: 0.1, w: 0.2, h: 0.02 },
                },
                {
                  rowIndex: 1,
                  colIndex: 0,
                  text: "Rent",
                  bbox: { x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
                },
                {
                  rowIndex: 1,
                  colIndex: 1,
                  text: "12,000.00",
                  bbox: { x: 0.5, y: 0.2, w: 0.2, h: 0.02 },
                },
              ],
            },
          ],
        },
      ],
      run: { ...RUN },
    };
    const layoutAdapter = {
      name: "layout",
      async parseLayout() {
        return layout;
      },
      async extractFields() {
        throw new Error("unused");
      },
    } as unknown as ExtractorAdapter;

    const store = new InMemoryMappingsStore();
    await store.upsert(null, {
      labelNorm: "rent",
      taxonomyNodeKey: "is.opex.rent",
      confidence: 1,
      source: "human",
      usageCount: 1,
    });

    const deps = baseDeps({ db, statementLayout: layoutAdapter, mappingsStore: store });
    const result = await runExtractStage(deps, {
      ...INPUT,
      logicalDocuments: [
        {
          id: "ld-p",
          formFamily: "PNL",
          taxYear: null,
          pageStart: 1,
          pageEnd: 1,
          entityId: "ent-1",
        },
      ],
    });

    expect(result.factsInserted).toBe(1);
    expect(db.facts[0]).toMatchObject({
      taxonomy_node_key: "is.opex.rent",
      value_cents: "1200000",
      method: "vendor",
      status: "suggested", // statement mapping is judgment → review owns it
      registry_field_id: null,
    });
    expect(db.periods.has("FY2024")).toBe(true);
    expect(db.runs.at(-1)).toMatchObject({ stage: "extract_statement", status: "succeeded" });
  });
});

describe("statement extraction resilience (bake-off finding, 2026-07-20)", () => {
  it("a throwing label classifier degrades to learned-mappings-only - never aborts", async () => {
    const db = new FakeDb();
    const layout: LayoutParseResult = {
      pages: [
        {
          page: 1,
          textBlocks: [],
          tables: [
            {
              page: 1,
              bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 },
              cells: [
                { rowIndex: 0, colIndex: 0, text: "", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.02 } },
                {
                  rowIndex: 0,
                  colIndex: 1,
                  text: "FY2024",
                  bbox: { x: 0.5, y: 0.1, w: 0.2, h: 0.02 },
                },
                {
                  rowIndex: 1,
                  colIndex: 0,
                  text: "Rent",
                  bbox: { x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
                },
                {
                  rowIndex: 1,
                  colIndex: 1,
                  text: "12,000.00",
                  bbox: { x: 0.5, y: 0.2, w: 0.2, h: 0.02 },
                },
                {
                  rowIndex: 2,
                  colIndex: 0,
                  text: "Zorbified Fees",
                  bbox: { x: 0.1, y: 0.3, w: 0.2, h: 0.02 },
                },
                {
                  rowIndex: 2,
                  colIndex: 1,
                  text: "500.00",
                  bbox: { x: 0.5, y: 0.3, w: 0.2, h: 0.02 },
                },
              ],
            },
          ],
        },
      ],
      run: { ...RUN },
    };
    const layoutAdapter = {
      name: "layout",
      async parseLayout() {
        return layout;
      },
      async extractFields() {
        throw new Error("unused");
      },
    } as unknown as ExtractorAdapter;

    const store = new InMemoryMappingsStore();
    await store.upsert(null, {
      labelNorm: "rent",
      taxonomyNodeKey: "is.opex.rent",
      confidence: 1,
      source: "human",
      usageCount: 1,
    });

    const deps = baseDeps({
      db,
      statementLayout: layoutAdapter,
      mappingsStore: store,
      // Classifier is DOWN (credits/outage): the unknown label must route
      // to review, the known label must still become a fact.
      labelClassifier: {
        classifyLabels: () => Promise.reject(new Error("credit balance is too low")),
      },
    });
    const result = await runExtractStage(deps, {
      ...INPUT,
      logicalDocuments: [
        {
          id: "ld-p",
          formFamily: "PNL",
          taxYear: null,
          pageStart: 1,
          pageEnd: 1,
          entityId: "ent-1",
        },
      ],
    });

    expect(result.perDocument[0]?.skipped).toBeUndefined();
    expect(db.facts.some((f) => f.taxonomy_node_key === "is.opex.rent")).toBe(true);
  });
});

describe("runExtractStage - span coverage (M13.5 regression)", () => {
  /**
   * Disjoint spans of the SAME form and year must each be extracted.
   * They used to collapse onto the earliest span on the premise that
   * "adapters read the whole file anyway" - which stopped being true when
   * extraction started slicing to each span's own pages. An 1120-S with
   * interleaved K-1s silently lost every page after the first fragment,
   * while the run log claimed the fragment was covered.
   */
  it("interleaved fragments of one form are BOTH extracted, not collapsed", async () => {
    const db = new FakeDb();
    // A whole-file read (slice fallback) returns findings from BOTH
    // fragments' pages; the M14.6 page-ownership guard means each span
    // keeps exactly the finding on its own pages - both extract, neither
    // collapses, and nothing is double-counted.
    const whole = [
      { ...cand("f1120s.line1c", "121125"), page: 2 },
      { ...cand("f1120s.line2", "50000"), page: 7 },
    ];
    const deps = baseDeps({
      db,
      path1ForFamily: () => adapterReturning(whole),
      path2: adapterReturning(whole),
    });
    const front = { ...LD_1120S, id: "ld-front", pageStart: 1, pageEnd: 3 };
    const back = { ...LD_1120S, id: "ld-back", pageStart: 6, pageEnd: 9 };

    const result = await runExtractStage(deps, {
      ...INPUT,
      logicalDocuments: [front, back],
    });

    const skipped = result.perDocument.filter((p) => p.skipped !== undefined);
    expect(skipped, JSON.stringify(result.perDocument)).toHaveLength(0);
    expect(result.perDocument.map((p) => p.logicalDocumentId).sort()).toEqual([
      "ld-back",
      "ld-front",
    ]);
    // Both spans produced their own lineage.
    expect(new Set(db.facts.map((f) => f.source_logical_document_id))).toEqual(
      new Set(["ld-front", "ld-back"]),
    );
  });

  it("a span contained inside a wider span of the same form is still skipped once", async () => {
    const db = new FakeDb();
    const deps = baseDeps({
      db,
      path1ForFamily: () => adapterReturning([cand("f1120s.line1c", "121125")]),
      path2: adapterReturning([cand("f1120s.line1c", "121125")]),
    });
    const wide = { ...LD_1120S, id: "ld-wide", pageStart: 1, pageEnd: 9 };
    const inner = { ...LD_1120S, id: "ld-inner", pageStart: 3, pageEnd: 5 };

    const result = await runExtractStage(deps, {
      ...INPUT,
      logicalDocuments: [wide, inner],
    });

    const skipped = result.perDocument.filter((p) => p.skipped !== undefined);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.logicalDocumentId).toBe("ld-inner");
    expect(skipped[0]!.skipped).toContain("duplicate span");
  });
});

describe("out-of-span guard (M14.6 - the Golden Deal duplicate-facts incident)", () => {
  // Four fragment spans of one return each got a whole-file read (slice
  // fallback) and re-extracted page 1's tax line; the spread summed the
  // same printed $14,309 four times. A candidate on a page outside the
  // span is proof the reading escaped the span - it must be dropped, and
  // the drop must be visible in the run metadata.
  it("drops whole-file candidates whose page belongs to another span", async () => {
    const db = new FakeDb();
    db.entities = [{ id: "e-1", kind: "target" }];
    const deps = baseDeps({
      db,
      path1ForFamily: () =>
        adapterReturning([
          // The real line 12, printed on physical page 7 - NOT this span's.
          { ...cand("f1120s.line12", "14,309."), page: 7 },
          // A value genuinely on this span's pages survives.
          { ...cand("f1120s.line1a", "100."), page: 14 },
        ]),
    });
    const fragment = { ...LD_1120S, id: "ld-frag", pageStart: 14, pageEnd: 15 };
    await runExtractStage(deps, { ...INPUT, logicalDocuments: [fragment] });

    expect(db.facts.some((f) => f.registry_field_id === "f1120s.line12")).toBe(false);
    const kept = db.facts.find((f) => f.registry_field_id === "f1120s.line1a");
    expect(kept).toBeDefined();
    expect(kept!.source_page).toBe(1); // global 14 → span-relative 1

    const consensus = db.runs.find((r) => r.stage === "extract_consensus");
    expect(consensus?.metadata).toMatchObject({ sliceFallback: true, outOfSpanDropped: 1 });
  });
});
