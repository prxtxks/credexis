import { describe, expect, it } from "vitest";
import { moneyColumnWidth } from "./ag-grid-theme";

describe("moneyColumnWidth (M13.2 - currency never clips)", () => {
  it("keeps the classic width for small values", () => {
    // "$4,200.00" - 9 chars - stays at the 130px floor.
    expect(moneyColumnWidth(9)).toBe(130);
  });

  it("grows past the old fixed 130px for the walkthrough's clipped value", () => {
    // "$1,500,000,000.00" is 17 chars and rendered clipped at width 130
    // (first-deal walkthrough P1-2). With the ✓IRS suffix it is 22.
    expect(moneyColumnWidth(17)).toBeGreaterThan(130);
    expect(moneyColumnWidth(22)).toBeGreaterThan(moneyColumnWidth(17));
  });
});
