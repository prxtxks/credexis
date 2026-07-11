import { describe, expect, it } from "vitest";
import {
  bboxSchema,
  centsString,
  corpusManifestSchema,
  groundTruthDocumentSchema,
  groundTruthFieldSchema,
} from "./ground-truth.js";

const validField = {
  registry_field_id: "f1120s.line21",
  period: "FY2023",
  value_cents: "-1250000",
  page: 1,
  bbox: { x: 0.62, y: 0.4, w: 0.2, h: 0.02 },
};

const validDoc = {
  id: "1120s-2023-native-001",
  form_family: "1120S",
  tax_year: 2023,
  entity: "applicant",
  quality: "native",
  synthetic: false,
  pdf_sha256: "a".repeat(64),
  page_count: 5,
  labeled_by: "pratik",
  labeled_at: "2026-07-11T12:00:00Z",
  fields: [validField],
};

describe("centsString — bigint over JSON (Iron Law #2)", () => {
  it("parses digits to bigint, preserving sign and magnitude", () => {
    expect(centsString.parse("-1250000")).toBe(-1250000n);
    expect(centsString.parse("0")).toBe(0n);
    // Beyond Number.MAX_SAFE_INTEGER — exactly why this is a string.
    expect(centsString.parse("9007199254740993")).toBe(9007199254740993n);
  });

  it("rejects floats, separators, and raw numbers", () => {
    expect(() => centsString.parse("12.50")).toThrow();
    expect(() => centsString.parse("1,250")).toThrow();
    expect(() => centsString.parse(1250 as unknown as string)).toThrow();
  });
});

describe("bboxSchema", () => {
  it("accepts a normalized box inside the page", () => {
    expect(bboxSchema.parse({ x: 0, y: 0, w: 1, h: 1 })).toBeTruthy();
  });

  it("rejects boxes that overflow the page or have zero size", () => {
    expect(() => bboxSchema.parse({ x: 0.9, y: 0.1, w: 0.2, h: 0.05 })).toThrow();
    expect(() => bboxSchema.parse({ x: 0.1, y: 0.9, w: 0.05, h: 0.2 })).toThrow();
    expect(() => bboxSchema.parse({ x: 0.1, y: 0.1, w: 0, h: 0.1 })).toThrow();
    expect(() => bboxSchema.parse({ x: -0.1, y: 0.1, w: 0.2, h: 0.1 })).toThrow();
  });
});

describe("groundTruthFieldSchema", () => {
  it("accepts a registry-keyed tax-form field", () => {
    const parsed = groundTruthFieldSchema.parse(validField);
    expect(parsed.value_cents).toBe(-1250000n);
  });

  it("accepts a taxonomy-keyed statement field", () => {
    const parsed = groundTruthFieldSchema.parse({
      taxonomy_node: "revenue.product_sales",
      period: "2025-01..2025-06",
      value_cents: "84210050",
      page: 2,
    });
    expect(parsed.value_cents).toBe(84210050n);
  });

  it("accepts null value_cents (genuinely blank field)", () => {
    const parsed = groundTruthFieldSchema.parse({ ...validField, value_cents: null });
    expect(parsed.value_cents).toBeNull();
  });

  it("rejects a field with BOTH registry id and taxonomy node", () => {
    expect(() =>
      groundTruthFieldSchema.parse({ ...validField, taxonomy_node: "revenue" }),
    ).toThrow();
  });

  it("rejects a field with NEITHER identifier", () => {
    const { registry_field_id: _drop, ...rest } = validField;
    expect(() => groundTruthFieldSchema.parse(rest)).toThrow();
  });

  it("rejects a zero/negative page", () => {
    expect(() => groundTruthFieldSchema.parse({ ...validField, page: 0 })).toThrow();
  });
});

describe("groundTruthDocumentSchema", () => {
  it("accepts a complete document and transforms cents", () => {
    const parsed = groundTruthDocumentSchema.parse(validDoc);
    expect(parsed.fields[0]?.value_cents).toBe(-1250000n);
    expect(parsed.synthetic).toBe(false);
  });

  it("accepts a statement doc with null tax_year", () => {
    const parsed = groundTruthDocumentSchema.parse({
      ...validDoc,
      id: "pnl-quickbooks-native-001",
      form_family: "PNL",
      tax_year: null,
      fields: [
        {
          taxonomy_node: "revenue.total",
          period: "FY2024",
          value_cents: "100000000",
          page: 1,
        },
      ],
    });
    expect(parsed.tax_year).toBeNull();
  });

  it("requires the synthetic flag explicitly (never defaulted)", () => {
    const { synthetic: _drop, ...rest } = validDoc;
    expect(() => groundTruthDocumentSchema.parse(rest)).toThrow();
  });

  it("rejects unknown form families and qualities", () => {
    expect(() => groundTruthDocumentSchema.parse({ ...validDoc, form_family: "1099" })).toThrow();
    expect(() => groundTruthDocumentSchema.parse({ ...validDoc, quality: "photo" })).toThrow();
  });

  it("rejects malformed ids and hashes", () => {
    expect(() => groundTruthDocumentSchema.parse({ ...validDoc, id: "Bad_ID" })).toThrow();
    expect(() => groundTruthDocumentSchema.parse({ ...validDoc, pdf_sha256: "xyz" })).toThrow();
  });

  it("rejects an empty fields list", () => {
    expect(() => groundTruthDocumentSchema.parse({ ...validDoc, fields: [] })).toThrow();
  });
});

describe("corpusManifestSchema", () => {
  it("accepts a manifest with a not-yet-uploaded PDF", () => {
    const parsed = corpusManifestSchema.parse({
      version: 1,
      updated_at: "2026-07-11T12:00:00Z",
      documents: [
        {
          id: "1120s-2023-native-001",
          ground_truth_path: "ground-truth/1120s-2023-native-001.json",
          pdf_sha256: "b".repeat(64),
          pdf_bytes: 123456,
          pdf_bucket_key: null,
        },
      ],
    });
    expect(parsed.documents).toHaveLength(1);
  });

  it("rejects a wrong version", () => {
    expect(() =>
      corpusManifestSchema.parse({ version: 2, updated_at: "2026-07-11T12:00:00Z", documents: [] }),
    ).toThrow();
  });
});
