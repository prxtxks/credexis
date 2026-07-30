import { describe, expect, it } from "vitest";
import { cents } from "@credexis/shared";
import type { AddbackSuggestion } from "@credexis/engine";
import { bigintFromDb, newSuggestions } from "./logic";

const s = (factId: string, category: AddbackSuggestion["category"]): AddbackSuggestion => ({
  factId,
  entityId: "e-1",
  periodLabel: "FY2023",
  category,
  amountCents: cents(100n),
  rationale: "test",
});

describe("newSuggestions", () => {
  it("keeps only pairs not already persisted - a rejection stays rejected", () => {
    const result = newSuggestions(
      [s("f-1", "interest"), s("f-2", "officer_comp"), s("f-1", "one_time")],
      [
        { factId: "f-1", category: "interest" }, // exists (maybe rejected) → skip
        { factId: null, category: "one_time" }, // manual addback, never blocks
      ],
    );
    expect(result.map((r) => [r.factId, r.category])).toEqual([
      ["f-2", "officer_comp"],
      ["f-1", "one_time"],
    ]);
  });
});

describe("bigintFromDb", () => {
  it("decodes numbers and strings exactly", () => {
    expect(bigintFromDb(12_345)).toBe(12_345n);
    expect(bigintFromDb(-500)).toBe(-500n);
    expect(bigintFromDb("9007199254740993")).toBe(9007199254740993n);
  });

  it("fails loudly beyond the safe-integer range", () => {
    expect(() => bigintFromDb(Number.MAX_SAFE_INTEGER + 2)).toThrow(/MAX_SAFE_INTEGER/);
  });
});
