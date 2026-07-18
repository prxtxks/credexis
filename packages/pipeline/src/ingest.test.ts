import { describe, expect, it } from "vitest";
import { sha256Hex } from "@credexis/shared";
import type { PageClassification, PageInput } from "@credexis/extraction";
import { runIngest, type IngestDeps, type IngestPayload } from "./ingest.js";
import type {
  DbPort,
  DocumentRow,
  ExtractionRunInsert,
  LogicalDocumentInsert,
  StoragePort,
  VirusScanner,
} from "./ports.js";

/* ── fakes ────────────────────────────────────────────────────────────── */

class FakeDb implements DbPort {
  doc: DocumentRow | null = null;
  statuses: string[] = [];
  virusScans: string[] = [];
  logicalDocs: (LogicalDocumentInsert & { id: string })[] = [];
  pages: { tenantId: string; logicalDocumentId: string; pageNumber: number }[] = [];
  runs: ExtractionRunInsert[] = [];

  async getDocument(id: string): Promise<DocumentRow | null> {
    return this.doc && this.doc.id === id ? this.doc : null;
  }
  async setDocumentStatus(_id: string, status: string): Promise<void> {
    this.statuses.push(status);
  }
  async setVirusScan(_id: string, status: string): Promise<void> {
    this.virusScans.push(status);
  }
  async insertLogicalDocument(row: LogicalDocumentInsert): Promise<string> {
    const id = `ld-${this.logicalDocs.length + 1}`;
    this.logicalDocs.push({ ...row, id });
    return id;
  }
  async insertPages(rows: FakeDb["pages"]): Promise<void> {
    this.pages.push(...rows);
  }
  async insertExtractionRun(row: ExtractionRunInsert): Promise<void> {
    this.runs.push(row);
  }
}

class FakeStorage implements StoragePort {
  constructor(private files: Record<string, Uint8Array>) {}
  async download(path: string): Promise<Uint8Array> {
    const bytes = this.files[path];
    if (!bytes) throw new Error(`no object at ${path}`);
    return bytes;
  }
}

const cleanScanner: VirusScanner = {
  scan: async () => ({ status: "clean", engine: "fake-av-1" }),
};
const infectedScanner: VirusScanner = {
  scan: async () => ({ status: "infected", engine: "fake-av-1", detail: "EICAR-Test" }),
};

/* ── fixture: a 3-page native bundle (1120-S ×2 + P&L) ────────────────── */

const PAGE_1120S_P1 = `Form 1120-S U.S. Income Tax Return for an S Corporation
OMB No. 1545-0123   For calendar year 2023
ACME HOLDINGS LLC
Department of the Treasury`;
const PAGE_1120S_P2 = `Form 1120-S (2023) Page 2
Schedule B Other Information`;
const PAGE_PNL = `ACME HOLDINGS LLC
Profit and Loss Statement
January through December 2023`;

const BUNDLE_TEXTS = [PAGE_1120S_P1, PAGE_1120S_P2, PAGE_PNL];

async function setup(opts?: {
  scanner?: VirusScanner | null;
  classifier?: { classifyPages(p: PageInput[]): Promise<PageClassification[]> } | null;
  pageTexts?: string[];
  mimeType?: string;
  sha256?: string;
  takeLlmUsage?: IngestDeps["takeLlmUsage"];
}): Promise<{ db: FakeDb; deps: IngestDeps; payload: IngestPayload }> {
  const bytes = new TextEncoder().encode("%PDF-fake-bytes");
  const db = new FakeDb();
  db.doc = {
    id: "doc-1",
    tenantId: "ten-1",
    dealId: "deal-1",
    fileName: "bundle.pdf",
    storagePath: "ten-1/deal-1/abc.pdf",
    sha256: opts?.sha256 ?? (await sha256Hex(bytes)),
    bytes: bytes.byteLength,
    mimeType: opts?.mimeType ?? "application/pdf",
  };
  const texts = opts?.pageTexts ?? BUNDLE_TEXTS;
  const deps: IngestDeps = {
    db,
    storage: new FakeStorage({ "ten-1/deal-1/abc.pdf": bytes }),
    scanner: opts?.scanner === undefined ? cleanScanner : opts.scanner,
    classifier: opts?.classifier ?? null,
    ...(opts?.takeLlmUsage ? { takeLlmUsage: opts.takeLlmUsage } : {}),
    extractPdf: async () => ({ pageCount: texts.length, pageTexts: texts }),
  };
  return { db, deps, payload: { documentId: "doc-1", tenantId: "ten-1", dealId: "deal-1" } };
}

/* ── tests ────────────────────────────────────────────────────────────── */

describe("runIngest", () => {
  it("splits a native bundle deterministically and marks it processed", async () => {
    const { db, deps, payload } = await setup();
    const result = await runIngest(deps, payload);

    expect(result.status).toBe("processed");
    expect(db.statuses).toEqual(["processing", "processed"]);
    expect(db.virusScans).toEqual(["clean"]);

    // Two logical documents: the 1120-S span and the P&L.
    expect(db.logicalDocs).toHaveLength(2);
    expect(db.logicalDocs[0]).toMatchObject({
      formFamily: "1120S",
      taxYear: 2023,
      pageStart: 1,
      pageEnd: 2,
    });
    expect(db.logicalDocs[1]).toMatchObject({ formFamily: "PNL", pageStart: 3, pageEnd: 3 });

    // Page rows: 1-based within each logical document.
    expect(db.pages.map((p) => [p.logicalDocumentId, p.pageNumber])).toEqual([
      ["ld-1", 1],
      ["ld-1", 2],
      ["ld-2", 1],
    ]);

    // One run per stage, both succeeded, deterministic split costs nothing.
    expect(db.runs.map((r) => [r.stage, r.status])).toEqual([
      ["ingest", "succeeded"],
      ["split_classify", "succeeded"],
    ]);
    const split = db.runs[1]!;
    expect(split.pageCount).toBe(3);
    expect(split.costMicroUsd).toBe(0n);
    expect(split.model).toBeNull();
  });

  it("blocks an infected file before any splitting", async () => {
    const { db, deps, payload } = await setup({ scanner: infectedScanner });
    const result = await runIngest(deps, payload);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("infected");
    expect(db.statuses).toEqual(["processing", "failed"]);
    expect(db.virusScans).toEqual(["infected"]);
    expect(db.logicalDocs).toHaveLength(0);
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0]).toMatchObject({ stage: "ingest", status: "failed" });
  });

  it("leaves virus_scan pending when no scanner is wired, and continues", async () => {
    const { db, deps, payload } = await setup({ scanner: null });
    const result = await runIngest(deps, payload);

    expect(result.status).toBe("processed");
    expect(result.virusScan).toBe("pending");
    expect(db.virusScans).toEqual([]); // column keeps its honest default
  });

  it("fails closed when storage bytes do not match the recorded sha256", async () => {
    const { db, deps, payload } = await setup({ sha256: "deadbeef".repeat(8) });
    const result = await runIngest(deps, payload);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("integrity");
    expect(db.statuses).toEqual(["processing", "failed"]);
    expect(db.logicalDocs).toHaveLength(0);
  });

  it("classifies signal-less pages via the LLM seam and records the spend", async () => {
    const classifier = {
      async classifyPages(pages: PageInput[]): Promise<PageClassification[]> {
        return pages.map((p) => ({
          page: p.page,
          formFamily: "1040" as const,
          taxYear: 2022,
          isDocumentStart: p.page === 1,
          confidence: 0.8,
          method: "llm" as const,
          matched: ["llm"],
        }));
      },
    };
    const { db, deps, payload } = await setup({
      pageTexts: ["no printed signals here", "still nothing recognizable"],
      classifier,
      takeLlmUsage: () => [{ model: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 200 }],
    });
    const result = await runIngest(deps, payload);

    expect(result.status).toBe("processed");
    expect(db.logicalDocs).toHaveLength(1);
    expect(db.logicalDocs[0]).toMatchObject({ formFamily: "1040", taxYear: 2022 });
    const split = db.runs.find((r) => r.stage === "split_classify")!;
    // 1000 in × $1/MTok + 200 out × $5/MTok = 2000 micro-USD, exact integers.
    expect(split.costMicroUsd).toBe(2000n);
    expect(split.model).toBe("claude-haiku-4-5");
  });

  it("stores unresolved spans as UNKNOWN for the review queue — never guesses", async () => {
    const { db, deps, payload } = await setup({
      pageTexts: ["no printed signals here"],
      classifier: null,
    });
    const result = await runIngest(deps, payload);

    expect(result.status).toBe("processed");
    expect(db.logicalDocs).toHaveLength(1);
    expect(db.logicalDocs[0]).toMatchObject({ formFamily: "UNKNOWN", taxYear: null });
    const split = db.runs.find((r) => r.stage === "split_classify")!;
    expect(split.metadata).toMatchObject({ unresolvedPages: 1 });
  });

  it("wraps a non-PDF upload as a single UNKNOWN logical document", async () => {
    const { db, deps, payload } = await setup({ mimeType: "image/png" });
    const result = await runIngest(deps, payload);

    expect(result.status).toBe("processed");
    expect(db.logicalDocs).toHaveLength(1);
    expect(db.logicalDocs[0]).toMatchObject({ formFamily: "UNKNOWN", pageStart: 1, pageEnd: 1 });
    expect(db.pages).toHaveLength(1);
  });

  it("throws (→ task retry) when the document row does not exist", async () => {
    const { deps } = await setup();
    await expect(
      runIngest(deps, { documentId: "doc-missing", tenantId: "ten-1", dealId: "deal-1" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws on a payload whose tenant/deal do not match the document row", async () => {
    const { deps, payload } = await setup();
    await expect(runIngest(deps, { ...payload, tenantId: "ten-EVIL" })).rejects.toThrow(/mismatch/);
  });
});
