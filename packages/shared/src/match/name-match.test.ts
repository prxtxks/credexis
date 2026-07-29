import { describe, expect, it } from "vitest";
import { jaroWinkler, matchBusinessName, matchPersonName } from "./name-match.js";

/** Design 02 §3.7 fixture table — bands are the contract, scores may drift. */
describe("person name matching (M11.4)", () => {
  it.each<[string, string, "high" | "mid" | "low"]>([
    ["John Smith", "John Smith", "high"],
    ["John Smith", "John H Smith", "high"], // middle initial ignored-ish
    ["John Smith", "John H. Smith", "high"],
    ["Smith John", "John Smith", "high"], // order-free
    ["John Smith", "J Smith", "mid"], // initial-only first name → human approves
    ["John Smith", "Jon Smith", "high"], // spelling variant, JW catches
    ["John Smith", "Jane Smith", "low"],
    ["John Smith", "Robert Jones", "low"],
    ["Arvind Patel", "ARVIND PATEL", "high"], // case-blind
  ])("%s vs %s → %s", (a, b, expected) => {
    expect(matchPersonName(a, b).band).toBe(expected);
  });

  it("returns a 0..1 score suitable for 'matches NN%' display", () => {
    const m = matchPersonName("John Smith", "John H Smith");
    expect(m.score).toBeGreaterThan(0.8);
    expect(m.score).toBeLessThanOrEqual(1);
  });
});

describe("business name matching (M11.4)", () => {
  it.each<[string, string, "high" | "mid" | "low"]>([
    ["Acme Corp", "ACME CORPORATION", "high"], // suffix-blind + case-blind
    ["Acme Corp LLC", "Acme Corporation", "high"],
    ["Acme Corp", "Acme Corp DBA Sunrise Motel", "high"], // DBA segment match
    ["Sunrise Motel", "Acme Corp DBA Sunrise Motel", "high"], // other segment
    ["Acme Corp", "Sunrise Motel LLC", "low"],
    ["Niyazi Hotels & Resorts Inc.", "NIYAZI HOTELS AND RESORTS", "high"], // '&' vs 'and' — same business
    ["Hospitality Jeff Management LLC", "Hospitality Jeff Management", "high"],
  ])("%s vs %s → %s", (a, b, expected) => {
    expect(matchBusinessName(a, b).band).toBe(expected);
  });
});

describe("jaroWinkler primitive", () => {
  it("is 1 on equality, 0 on empty, symmetric-ish on variants", () => {
    expect(jaroWinkler("smith", "smith")).toBe(1);
    expect(jaroWinkler("", "smith")).toBe(0);
    expect(jaroWinkler("john", "jon")).toBeGreaterThan(0.9);
    expect(jaroWinkler("john", "jane")).toBeLessThan(0.75);
  });
});
