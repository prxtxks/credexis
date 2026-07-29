import { describe, expect, it } from "vitest";
import { matchDocumentEntities, pickIdentity } from "./match.js";
import type { FieldCandidate } from "../types.js";

const cand = (fieldId: string, valueText: string | null, page = 1): FieldCandidate => ({
  fieldId,
  valueText,
  page: valueText === null ? null : page,
  bbox: null,
  confidence: 0.9,
});

describe("pickIdentity (M11.6)", () => {
  it("prefers the vendor's read (geometry lineage) over the LLM's", () => {
    const id = pickIdentity(
      [cand("f1040.taxpayer_name", "John H Smith")],
      [cand("f1040.taxpayer_name", "John Smith")],
    );
    expect(id).toMatchObject({ name: "John H Smith", method: "vendor", kind: "person" });
  });

  it("falls back to the LLM when the vendor found nothing", () => {
    const id = pickIdentity(
      [cand("f1040.taxpayer_name", null)],
      [cand("f1040.taxpayer_name", "Arvind Patel", 7)],
    );
    expect(id).toMatchObject({ name: "Arvind Patel", method: "llm", page: 7 });
  });

  it("ignores junk reads and non-identity fields; null when absent", () => {
    expect(
      pickIdentity([cand("f1040.line9", "1,234.00"), cand("f1040.taxpayer_name", "  x ")], []),
    ).toBeNull();
  });

  it("classifies business identity fields", () => {
    const id = pickIdentity([cand("f1120s.corp_name", "PRAYOSHA, INC")], []);
    expect(id).toMatchObject({ kind: "business" });
  });
});

describe("matchDocumentEntities (M11.6)", () => {
  const entities = [
    { id: "e-biz", name: "Prayosha Inc", kind: "applicant" },
    { id: "e-guar", name: "Arvind Patel", kind: "guarantor" },
    { id: "e-spouse", name: "Priya Patel", kind: "spouse" },
  ];

  it("a 1040 name matches the guarantor, not the business", () => {
    const r = matchDocumentEntities(
      {
        fieldId: "f1040.taxpayer_name",
        name: "Arvind Patel",
        page: 1,
        method: "vendor",
        kind: "person",
      },
      entities,
    );
    expect(r).toMatchObject({ entityId: "e-guar", band: "high" });
    expect(r.scoreBps).toBeGreaterThan(9200);
  });

  it("a corp name matches the applicant business, suffix-blind", () => {
    const r = matchDocumentEntities(
      {
        fieldId: "f1120s.corp_name",
        name: "PRAYOSHA, INC",
        page: 1,
        method: "vendor",
        kind: "business",
      },
      entities,
    );
    expect(r).toMatchObject({ entityId: "e-biz", band: "high" });
  });

  it("a different person lands low — never partial credit", () => {
    const r = matchDocumentEntities(
      {
        fieldId: "f1040.taxpayer_name",
        name: "Robert Jones",
        page: 1,
        method: "vendor",
        kind: "person",
      },
      entities,
    );
    expect(r.band).toBe("low");
  });

  it("middle-initial variance stays approvable, not auto-silent", () => {
    const r = matchDocumentEntities(
      {
        fieldId: "f1040.taxpayer_name",
        name: "Arvind K. Patel",
        page: 1,
        method: "vendor",
        kind: "person",
      },
      entities,
    );
    expect(r.entityId).toBe("e-guar");
    expect(["high", "mid"]).toContain(r.band);
  });

  it("falls back to all entities when no kind-matching entity exists", () => {
    const r = matchDocumentEntities(
      {
        fieldId: "f1040.taxpayer_name",
        name: "Arvind Patel",
        page: 1,
        method: "vendor",
        kind: "person",
      },
      [{ id: "e-biz", name: "Prayosha Inc", kind: "applicant" }],
    );
    // Scored against the business — but a zero score names NO entity:
    // pointing at an entity with no evidence would be dishonest.
    expect(r.entityId).toBeNull();
    expect(r.band).toBe("low");
  });

  it("empty deal → null match", () => {
    const r = matchDocumentEntities(
      {
        fieldId: "f1040.taxpayer_name",
        name: "Arvind Patel",
        page: 1,
        method: "vendor",
        kind: "person",
      },
      [],
    );
    expect(r).toMatchObject({ entityId: null, band: "low" });
  });
});
