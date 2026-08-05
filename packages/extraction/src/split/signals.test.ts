import { describe, expect, it } from "vitest";
import { detectPageSignals, familyTokenEvidence } from "./signals.js";

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

  // Golden Deal 1 regression (2026-08-04): the standard bank debt-schedule
  // template instructs "Current balance should match the current balance
  // sheet" - the page IS a debt schedule that merely REFERENCES the balance
  // sheet. Most-specific-first: "debt schedule" outranks "balance sheet".
  it("a debt schedule referencing the balance sheet is still a debt schedule", () => {
    const s = detectPageSignals(
      "BUSINESS DEBT SCHEDULE Please include the following information on all " +
        "installment debts, notes, contracts and mortgages. Current balance should " +
        "match the current balance sheet. Include any capital leases shown on the " +
        "balance sheet.",
    );
    expect(s.formFamily).toBe("DEBT_SCHEDULE");
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

describe("IRS corpus sweep regressions (corpus-1: 69 docs / 1153 pages, 2026-07-30)", () => {
  // 2019-era revisions title schedules "(Form 1040 or 1040-SR)" - those
  // pages fell through to the bare-1040 pattern before the sweep.
  it("2019 '(Form 1040 or 1040-SR)' schedule pages classify as the schedule", () => {
    expect(
      detectPageSignals("Schedule C (Form 1040 or 1040-SR) 2019 Page 2 Part III Cost of Goods Sold")
        .formFamily,
    ).toBe("1040_SCH_C");
    const s1 = detectPageSignals(
      "SCHEDULE 1 (Form 1040 or 1040-SR) Department of the Treasury " +
        "Additional Income and Adjustments to Income OMB No. 1545-0074",
    );
    expect(s1.formFamily).toBe("1040_SCH_1");
    expect(s1.confidence).toBeCloseTo(0.98);
  });

  // W-2 PDFs ship instruction pages that discuss "the Form 1040
  // instructions" - references, not identity. They abstained after the fix.
  it("W-2 employee-instruction pages do not classify as 1040", () => {
    const s = detectPageSignals(
      "Notice to Employee Do you have to file? Refer to the Form 1040 instructions " +
        "to determine if you are required to file a tax return.",
    );
    expect(s.formFamily).toBeNull();
  });

  // Attachment cover forms cite the returns they attach to - verbatim
  // phrasings from Form 8916-A and Form 8453-CORP in the ATS bundles.
  it("forms citing their parent returns do not classify as the parent", () => {
    expect(
      detectPageSignals(
        "Form 8916-A (Rev. November 2019) Department of the Treasury " +
          "Supplemental Attachment to Schedule M-3 Attach to Schedule M-3 for " +
          "Form 1065, 1120, 1120-L, 1120-PC, or 1120-S. OMB No. 1545-0123",
      ).formFamily,
    ).toBeNull();
    expect(
      detectPageSignals(
        "Form 8453-CORP (December 2022) E-file Declaration for Corporations " +
          "File electronically with Form 1120, 1120-F, or 1120-S. OMB No. 1545-0123",
      ).formFamily,
    ).toBeNull();
  });

  // Form 1120-F is a DIFFERENT, unsupported form - a 42-page 1120-F return
  // classified as 1120 at 0.98 before the suffix lookahead.
  it("Form 1120-F pages abstain instead of classifying as 1120", () => {
    expect(
      detectPageSignals("Form 1120-F (2023) Page 2 Additional Information").formFamily,
    ).toBeNull();
    expect(
      detectPageSignals(
        "Form 1120-F U.S. Income Tax Return of a Foreign Corporation OMB No. 1545-0123",
      ).formFamily,
    ).toBeNull();
  });

  it("Form 1040-SR is the 1040 family; 1040-NR and 1040-X are not", () => {
    expect(
      detectPageSignals("Form 1040-SR U.S. Tax Return for Seniors 2023 OMB No. 1545-0074")
        .formFamily,
    ).toBe("1040");
    expect(
      detectPageSignals("Form 1040-NR U.S. Nonresident Alien Income Tax Return").formFamily,
    ).toBeNull();
    expect(
      detectPageSignals("Form 1040-X Amended U.S. Individual Income Tax Return").formFamily,
    ).toBeNull();
  });

  // The current W-2 revision prints OMB 1545-0029 (the W-2/W-3 series
  // number), and the W-2 title sits at the BOTTOM of the form - the OMB
  // number is the working signal.
  it("current-revision W-2 classifies from OMB 1545-0029", () => {
    const s = detectPageSignals(
      "22222 a Employee's social security number OMB No. 1545-0029 " +
        "b Employer identification number (EIN) 1 Wages, tips, other compensation",
    );
    expect(s.formFamily).toBe("W2");
    expect(s.confidence).toBeCloseTo(0.95);
  });

  // An unrecognized IRS page must not be keyword-guessed as a CPA
  // statement: 1120-F's Schedule L is not a freeform balance sheet.
  it("IRS-marked pages never fall to statement keywords", () => {
    const s = detectPageSignals(
      "Form 1120-F (2023) Page 5 SECTION II Schedule L Balance Sheets per Books",
    );
    expect(s.formFamily).toBeNull();
    expect(s.confidence).toBe(0);
  });
});

describe("4626 + token evidence (M13.1, first-deal walkthrough)", () => {
  it("Form 4626 classifies deterministically as known-but-unsupported", () => {
    const s = detectPageSignals(
      "Form 4626 Alternative Minimum Tax - Corporations OMB No. 1545-0123 2023",
    );
    expect(s.formFamily).toBe("4626");
    expect(s.confidence).toBeCloseTo(0.98);
    const cont = detectPageSignals("Form 4626 (2023) Page 6 Part V Additional information");
    expect(cont.formFamily).toBe("4626");
    expect(cont.continuationPage).toBe(6);
  });

  it("familyTokenEvidence distinguishes identity from citation", () => {
    const f1120p1 =
      "Form 1120 U.S. Corporation Income Tax Return OMB No. 1545-0123\n" +
      "12 Compensation of officers (see instructions - attach Form 1125-E)";
    expect(familyTokenEvidence(f1120p1, "1125E")).toBe("cited-only");
    expect(familyTokenEvidence(f1120p1, "1120")).toBe("anchored");
    expect(familyTokenEvidence("Form 1125-E Compensation of Officers", "1125E")).toBe("anchored");
    expect(familyTokenEvidence("ACME LLC Statement of Operations", "4562")).toBe("absent");
    const buried = "x".repeat(450) + " Form 4562 depreciation detail";
    expect(familyTokenEvidence(buried, "4562")).toBe("unanchored");
  });
});
