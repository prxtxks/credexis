import { corpusManifestSchema, type CorpusManifestEntry } from "@credexis/schema";
import { describe, expect, it } from "vitest";
import {
  groundTruthPath,
  parseFilledTemplate,
  renderYamlTemplate,
  upsertManifestEntry,
} from "./intake.js";

const pdfInfo = { sha256: "a".repeat(64), bytes: 1234, pageCount: 5 };

describe("renderYamlTemplate", () => {
  it("embeds id, hash, and page count so labels bind to exact bytes", () => {
    const yaml = renderYamlTemplate("1120s-2023-native-001", "return.pdf", pdfInfo);
    expect(yaml).toContain("id: 1120s-2023-native-001");
    expect(yaml).toContain(`pdf_sha256: ${"a".repeat(64)}`);
    expect(yaml).toContain("page_count: 5");
    expect(yaml).toContain("Iron Law #9");
  });
});

describe("parseFilledTemplate", () => {
  const filled = `
id: 1120s-2023-native-001
form_family: 1120S
tax_year: 2023
entity: applicant
quality: native
synthetic: false
pdf_sha256: "${"a".repeat(64)}"
page_count: 5
labeled_by: pratik
labeled_at: 2026-07-11T12:00:00Z
fields:
  - registry_field_id: f1120s.line1a
    period: FY2023
    value_cents: "125000000"
    page: 1
`;

  it("validates a filled template and transforms cents to bigint", () => {
    const { document } = parseFilledTemplate(filled);
    expect(document.fields[0]?.value_cents).toBe(125000000n);
  });

  it("returns the raw JSON form with cents still as strings (disk format)", () => {
    const { json } = parseFilledTemplate(filled);
    const fields = (json as { fields: Array<{ value_cents: unknown }> }).fields;
    expect(fields[0]?.value_cents).toBe("125000000");
  });

  it("rejects an unfilled/invalid template with a zod error", () => {
    expect(() => parseFilledTemplate("id: x\nform_family: NOPE\n")).toThrow();
  });

  it("rejects numeric (unquoted) value_cents — floats must be impossible", () => {
    expect(() => parseFilledTemplate(filled.replace('"125000000"', "125000000"))).toThrow();
  });
});

describe("groundTruthPath", () => {
  it("maps id → ground-truth/<id>.json", () => {
    expect(groundTruthPath("pnl-001")).toBe("ground-truth/pnl-001.json");
  });
});

describe("upsertManifestEntry", () => {
  const empty = corpusManifestSchema.parse({
    version: 1,
    updated_at: "2026-07-11T12:00:00Z",
    documents: [],
  });
  const entry: CorpusManifestEntry = {
    id: "b-doc",
    ground_truth_path: "ground-truth/b-doc.json",
    pdf_sha256: "b".repeat(64),
    pdf_bytes: 100,
    pdf_bucket_key: null,
  };
  const at = { updatedAt: "2026-07-11T13:00:00Z" };

  it("inserts a new entry and stamps updated_at", () => {
    const m = upsertManifestEntry(empty, entry, at);
    expect(m.documents).toHaveLength(1);
    expect(m.updated_at).toBe(at.updatedAt);
  });

  it("keeps documents sorted by id", () => {
    const m1 = upsertManifestEntry(empty, entry, at);
    const m2 = upsertManifestEntry(m1, { ...entry, id: "a-doc" }, at);
    expect(m2.documents.map((d) => d.id)).toEqual(["a-doc", "b-doc"]);
  });

  it("replaces an entry with the same id and same hash", () => {
    const m1 = upsertManifestEntry(empty, entry, at);
    const m2 = upsertManifestEntry(m1, { ...entry, pdf_bytes: 999 }, at);
    expect(m2.documents).toHaveLength(1);
    expect(m2.documents[0]?.pdf_bytes).toBe(999);
  });

  it("REFUSES to replace when pdf_sha256 changed (labels bind to bytes)", () => {
    const m1 = upsertManifestEntry(empty, entry, at);
    expect(() => upsertManifestEntry(m1, { ...entry, pdf_sha256: "c".repeat(64) }, at)).toThrow(
      /different pdf_sha256/,
    );
  });

  it("allows the hash change with force (deliberate re-verify)", () => {
    const m1 = upsertManifestEntry(empty, entry, at);
    const m2 = upsertManifestEntry(
      m1,
      { ...entry, pdf_sha256: "c".repeat(64) },
      { ...at, force: true },
    );
    expect(m2.documents[0]?.pdf_sha256).toBe("c".repeat(64));
  });
});
