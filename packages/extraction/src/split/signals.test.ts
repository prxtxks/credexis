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

describe("false-confidence probes (2026-07-30 adversarial review)", () => {
  // A real 1120-S page 1 prints "Compensation of officers" as LINE 7 and
  // "(attach Form 4562)" as a line-14 citation. Before this suite existed,
  // the page classified as its own 1125-E attachment at 0.98 - the
  // attachment title-phrase alternate matched a parent line label and the
  // family-shared OMB "corroborated" it. Line labels and citations are not
  // identity.
  it("a real 1120-S page 1 is an 1120-S, not its own attachment", () => {
    const s = detectPageSignals(
      "Form 1120-S U.S. Income Tax Return for an S Corporation\n" +
        "OMB No. 1545-0123  2023\n" +
        "1a Gross receipts or sales\n" +
        "2 Cost of goods sold (attach Form 1125-A)\n" +
        "3 Gross profit\n" +
        "7 Compensation of officers\n" +
        "8 Salaries and wages\n" +
        "14 Depreciation not claimed on Form 1125-A or elsewhere (attach Form 4562)",
    );
    expect(s.formFamily).toBe("1120S");
    expect(s.confidence).toBeCloseTo(0.98);
  });

  it("a real 1120 page 1 is an 1120 despite officer-comp and 4562 citations", () => {
    const s = detectPageSignals(
      "Form 1120 U.S. Corporation Income Tax Return OMB No. 1545-0123 2023\n" +
        "12 Compensation of officers (see instructions - attach Form 1125-E)\n" +
        "20 Depreciation from Form 4562 not claimed elsewhere (attach Form 4562)",
    );
    expect(s.formFamily).toBe("1120");
  });

  // A CPA-prepared P&L lists "Depreciation and amortization" as an expense
  // line. Before this suite it classified as Form 4562 at 0.9 - a generic
  // accounting phrase acting as an IRS identity signal.
  it("a CPA P&L with a depreciation line is a statement, not Form 4562", () => {
    const s = detectPageSignals(
      "ACME HOLDINGS LLC\nStatement of Operations\nFor the Year Ended December 31, 2023\n" +
        "Revenue\nCost of Goods Sold\nGross Profit\nOperating Expenses\n" +
        "Depreciation and amortization\nRent\nNet Income",
    );
    expect(s.formFamily).toBe("PNL");
    expect(s.confidence).toBeCloseTo(0.75);
  });

  // The real attachments must still classify by their own printed headers.
  it("a real 1125-E page still classifies", () => {
    const s = detectPageSignals(
      "Form 1125-E Compensation of Officers OMB No. 1545-0123\nAttach to Form 1120, 1120-C, 1120-F, or 1120-S.",
    );
    expect(s.formFamily).toBe("1125E");
    expect(s.confidence).toBeCloseTo(0.98);
  });

  it("a real 4562 page still classifies", () => {
    const s = detectPageSignals(
      "Form 4562 Depreciation and Amortization (Including Information on Listed Property) OMB No. 1545-0172 2023",
    );
    expect(s.formFamily).toBe("4562");
  });

  // A citation is never an identity: a cover note pointing at an attached
  // form must fall through to the LLM/review, not classify.
  it("a page that only cites a form does not classify as it", () => {
    const s = detectPageSignals("See attached Form 4562 for the depreciation detail.");
    expect(s.formFamily).toBeNull();
    expect(s.confidence).toBe(0);
  });

  // Identity lives in the header region. A form number buried deep in body
  // text (an engagement letter discussing the return) is not a header.
  it("a form number outside the header region does not classify", () => {
    const filler = "This letter summarizes the services provided during the engagement. ".repeat(8);
    const s = detectPageSignals(`${filler}We prepared and filed Form 1120-S for the year.`);
    expect(s.formFamily).toBeNull();
  });
});
