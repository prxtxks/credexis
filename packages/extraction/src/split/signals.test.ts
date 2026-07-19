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

describe("real-document regressions (2026-07-19 testing-docs trial)", () => {
  // A real 1040 page 1 says "Attach Form(s) W-2 here" — that reference must
  // never classify the page as a W-2 (it did, at 0.98 via shared-OMB boost).
  it("1040 page mentioning 'Attach Form(s) W-2' stays a 1040", () => {
    const s = detectPageSignals(
      "Form 1040 U.S. Individual Income Tax Return 2023 OMB No. 1545-0074\n" +
        "Attach Form(s) W-2 here. Also attach Forms W-2G and 1099-R if tax was withheld.",
    );
    expect(s.formFamily).toBe("1040");
    expect(s.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("a real W-2 (Wage and Tax Statement + its own OMB) still classifies", () => {
    const s = detectPageSignals("Form W-2 Wage and Tax Statement 2024 OMB No. 1545-0008 Copy B");
    expect(s.formFamily).toBe("W2");
  });

  // Schedule SE references "Schedule K-1 (Form 1065), box 14, code A" — a
  // reference with a box citation is not a K-1 title page.
  it("Schedule SE citing a K-1 box is not a K-1", () => {
    const s = detectPageSignals(
      "Schedule SE (Form 1040) Self-Employment Tax\n" +
        "Net farm profit or (loss) from Schedule F, line 34, and farm partnerships, " +
        "Schedule K-1 (Form 1065), box 14, code A",
    );
    expect(s.formFamily).not.toBe("K1_1065");
  });

  it("a real K-1 title page still classifies", () => {
    const s = detectPageSignals(
      "Schedule K-1 (Form 1065) 2023 Department of the Treasury Internal Revenue Service " +
        "Partner's Share of Income, Deductions, Credits, etc.",
    );
    expect(s.formFamily).toBe("K1_1065");
  });

  // The shared OMB 1545-0074 must only corroborate 1040-family pages —
  // never boost an unrelated family to 0.98.
  it("shared OMB numbers corroborate only compatible families", () => {
    const s = detectPageSignals("Wage and Tax Statement mention on a page with OMB No. 1545-0074");
    expect(s.confidence).toBeLessThan(0.98);
  });
});
