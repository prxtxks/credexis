import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_FAMILIES,
  buildAssignmentPatch,
  planSpanMerge,
  splitSpanAt,
  validateSpanEdit,
} from "./logic";

describe("buildAssignmentPatch", () => {
  it("builds a snake_case patch for a full fix", () => {
    expect(buildAssignmentPatch({ formFamily: "1120S", taxYear: 2023, entityId: "e-1" })).toEqual({
      form_family: "1120S",
      tax_year: 2023,
      entity_id: "e-1",
      entity_confirmed: true,
    });
  });

  it("accepts the UNKNOWN sentinel (sending a span back to unresolved)", () => {
    expect(buildAssignmentPatch({ formFamily: "UNKNOWN" })).toEqual({ form_family: "UNKNOWN" });
    expect(ASSIGNABLE_FAMILIES).toContain("UNKNOWN");
  });

  it("rejects a family outside the Stage-S vocabulary", () => {
    expect(() => buildAssignmentPatch({ formFamily: "1120-X" })).toThrow(/unknown form family/);
  });

  it("clears tax year with null and rejects out-of-range years", () => {
    expect(buildAssignmentPatch({ taxYear: null })).toEqual({ tax_year: null });
    expect(() => buildAssignmentPatch({ taxYear: 1999 })).toThrow(/out of range/);
    expect(() => buildAssignmentPatch({ taxYear: 2036 })).toThrow(/out of range/);
    expect(() => buildAssignmentPatch({ taxYear: 2023.5 })).toThrow(/out of range/);
  });

  it("un-assigning an entity clears the confirmation flag", () => {
    expect(buildAssignmentPatch({ entityId: null })).toEqual({
      entity_id: null,
      entity_confirmed: false,
    });
  });

  it("rejects an empty decision", () => {
    expect(() => buildAssignmentPatch({})).toThrow(/empty assignment/);
  });
});

describe("span editing (M13.5) - reviewers own the page ranges", () => {
  const target = { id: "a", pageStart: 2, pageEnd: 7 };
  const siblings = [
    { id: "cover", pageStart: 1, pageEnd: 1 },
    { id: "a", pageStart: 2, pageEnd: 7 },
    { id: "amt", pageStart: 8, pageEnd: 14 },
  ];

  it("accepts a shrunken range and returns the DB patch", () => {
    expect(validateSpanEdit(target, siblings, 2, 4)).toEqual({ page_start: 2, page_end: 4 });
  });

  it("rejects overlaps with sibling spans on the same file", () => {
    expect(() => validateSpanEdit(target, siblings, 2, 8)).toThrow(/overlap/);
    expect(() => validateSpanEdit(target, siblings, 1, 7)).toThrow(/overlap/);
  });

  it("rejects nonsense ranges", () => {
    expect(() => validateSpanEdit(target, siblings, 0, 3)).toThrow(/invalid/);
    expect(() => validateSpanEdit(target, siblings, 5, 3)).toThrow(/invalid/);
    expect(() => validateSpanEdit(target, siblings, 2.5 as number, 4)).toThrow(/invalid/);
  });

  it("splits a span into two halves at a page", () => {
    expect(splitSpanAt({ pageStart: 2, pageEnd: 7 }, 5)).toEqual({
      patch: { page_end: 4 },
      newSpan: { page_start: 5, page_end: 7 },
    });
  });

  it("refuses splits outside the span's interior", () => {
    expect(() => splitSpanAt({ pageStart: 2, pageEnd: 7 }, 2)).toThrow(/between 3 and 7/);
    expect(() => splitSpanAt({ pageStart: 2, pageEnd: 7 }, 8)).toThrow(/between 3 and 7/);
  });
});

describe("span merge (M13.5) - the inverse of split", () => {
  it("plans a merge of two adjacent spans, lower survives", () => {
    expect(
      planSpanMerge({ id: "a", pageStart: 2, pageEnd: 4 }, { id: "b", pageStart: 5, pageEnd: 7 }),
    ).toEqual({ survivorId: "a", absorbedId: "b", patch: { page_start: 2, page_end: 7 } });
  });

  it("is order-independent", () => {
    expect(
      planSpanMerge({ id: "b", pageStart: 5, pageEnd: 7 }, { id: "a", pageStart: 2, pageEnd: 4 }),
    ).toEqual({ survivorId: "a", absorbedId: "b", patch: { page_start: 2, page_end: 7 } });
  });

  it("refuses non-adjacent spans - a gap is the reviewer's to see", () => {
    expect(() =>
      planSpanMerge({ id: "a", pageStart: 2, pageEnd: 4 }, { id: "b", pageStart: 8, pageEnd: 14 }),
    ).toThrow(/adjacent/);
  });

  it("refuses merging a span with itself", () => {
    expect(() =>
      planSpanMerge({ id: "a", pageStart: 2, pageEnd: 4 }, { id: "a", pageStart: 2, pageEnd: 4 }),
    ).toThrow(/itself/);
  });
});
