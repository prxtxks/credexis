import { describe, expect, it } from "vitest";
import { detectPageSignals } from "./signals.js";

describe("deterministic page signals (M3.5)", () => {
  it("classifies IRS forms by printed form number + OMB corroboration", () => {
    const s = detectPageSignals(
      "Form 1120-S  U.S. Income Tax Return for an S Corporation  OMB No. 1545-0123\nFor calendar year 2023",
    );
    expect(s.formFamily).toBe("1120S");
    expect(s.taxYear).toBe(2023);
    expect(s.confidence).toBeCloseTo(0.98);
    expect(s.isDocumentStart).toBe(true);
  });

  it("K-1 wins over its parent form number (ordering trap)", () => {
    // A K-1 page literally contains "Form 1120-S" — must NOT classify as 1120S.
    const s = detectPageSignals(
      "Schedule K-1 (Form 1120-S)  Shareholder's Share of Income  OMB No. 1545-0123  2023",
    );
    expect(s.formFamily).toBe("K1_1120S");
  });

  it("1120S beats 1120 (specificity trap)", () => {
    expect(detectPageSignals("Form 1120S page").formFamily).toBe("1120S");
    expect(detectPageSignals("Form 1120 U.S. Corporation Income Tax Return").formFamily).toBe(
      "1120",
    );
  });

  it("an 1120-S Schedule L page is NOT a balance sheet statement (trap)", () => {
    const s = detectPageSignals("Form 1120-S (2023)  Page 4\nSchedule L  Balance Sheets per Books");
    expect(s.formFamily).toBe("1120S"); // IRS signal wins over keyword
    expect(s.continuationPage).toBe(4);
    expect(s.isDocumentStart).toBe(false);
  });

  it("statement keywords apply only without IRS signals", () => {
    expect(detectPageSignals("ACME LLC\nProfit and Loss\nJan - Dec 2024").formFamily).toBe("PNL");
    expect(detectPageSignals("ACME LLC\nBalance Sheet\nAs of Dec 31").formFamily).toBe(
      "BALANCE_SHEET",
    );
    expect(detectPageSignals("Business Debt Schedule").formFamily).toBe("DEBT_SCHEDULE");
  });

  it("W-2 classifies from its unique OMB number alone", () => {
    const s = detectPageSignals("22222  a Employee's SSN  OMB No. 1545-0008");
    expect(s.formFamily).toBe("W2");
    expect(s.confidence).toBeCloseTo(0.95);
  });

  it("1040 schedules beat the bare 1040 pattern", () => {
    expect(
      detectPageSignals("Schedule C (Form 1040) Profit or Loss From Business").formFamily,
    ).toBe("1040_SCH_C");
    expect(detectPageSignals("Schedule E (Form 1040) 2023").formFamily).toBe("1040_SCH_E");
    expect(detectPageSignals("Form 1040 U.S. Individual Income Tax Return").formFamily).toBe(
      "1040",
    );
  });

  it("blank/garbage pages resolve to nothing (LLM's or reviewer's job)", () => {
    const s = detectPageSignals("handwritten notes about the deal, no identifiers");
    expect(s.formFamily).toBeNull();
    expect(s.confidence).toBe(0);
    expect(s.isDocumentStart).toBe(false);
  });
});
