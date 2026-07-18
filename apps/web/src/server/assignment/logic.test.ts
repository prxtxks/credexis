import { describe, expect, it } from "vitest";
import { ASSIGNABLE_FAMILIES, buildAssignmentPatch } from "./logic";

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
