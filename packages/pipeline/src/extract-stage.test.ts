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

describe("runExtractStage — tax forms", () => {
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

describe("runExtractStage — statements", () => {
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
  it("a throwing label classifier degrades to learned-mappings-only — never aborts", async () => {
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
