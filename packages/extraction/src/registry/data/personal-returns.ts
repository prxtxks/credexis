/**
 * Personal return registries: 1040 + Schedules 1/C/E (tax years 2023–2025).
 * These feed guarantor personal cash flow (Blueprint §7 / M7.4).
 * ⚠️ [PRATIK] reviews field lists against real underwriting needs (M4.1).
 */

import type { FormDefinition } from "../types.js";
import { identityText, money } from "./helpers.js";

export const F1040: FormDefinition = {
  formFamily: "1040",
  baseYear: 2023,
  base: {
    fields: [
      identityText(
        "f1040.taxpayer_name",
        "Name of taxpayer (first name, middle initial, last name as printed at the top of Form 1040)",
        "Concatenate the printed first name, middle initial, and last name boxes. Primary taxpayer only — not the spouse.",
      ),
      money("f1040.line1a", "1a", "Total amount from Form(s) W-2, box 1", {
        aliases: ["Wages, salaries, tips"],
        taxonomyNodeKey: "pcf.income.wages",
      }),
      money("f1040.line2b", "2b", "Taxable interest", {
        taxonomyNodeKey: "pcf.income.interest_dividends",
      }),
      money("f1040.line3b", "3b", "Ordinary dividends", {
        taxonomyNodeKey: "pcf.income.interest_dividends",
      }),
      money("f1040.line4b", "4b", "IRA distributions — taxable amount", {
        taxonomyNodeKey: "pcf.income.retirement",
      }),
      money("f1040.line5b", "5b", "Pensions and annuities — taxable amount", {
        taxonomyNodeKey: "pcf.income.retirement",
      }),
      money("f1040.line6b", "6b", "Social security benefits — taxable amount", {
        taxonomyNodeKey: "pcf.income.social_security",
      }),
      money("f1040.line7", "7", "Capital gain or (loss)", {
        taxonomyNodeKey: "pcf.income.capital_gains",
      }),
      money("f1040.line8", "8", "Additional income from Schedule 1, line 10", {
        taxonomyNodeKey: "pcf.income.other",
      }),
      money("f1040.line9", "9", "Total income", { taxonomyNodeKey: "pcf.income.total" }),
      money("f1040.line10", "10", "Adjustments to income from Schedule 1, line 26", {
        taxonomyNodeKey: "pcf.outflow.other",
      }),
      money("f1040.line11", "11", "Adjusted gross income", {
        aliases: ["AGI"],
      }),
      money("f1040.line12", "12", "Standard deduction or itemized deductions"),
      money("f1040.line15", "15", "Taxable income"),
      money("f1040.line22", "22", "Total tax before other taxes", { pageHint: 2 }),
      money("f1040.line24", "24", "Total tax", {
        pageHint: 2,
        taxonomyNodeKey: "pcf.outflow.federal_taxes",
      }),
    ],
    relations: [
      {
        id: "1040.agi",
        type: "difference",
        result: "f1040.line11",
        operands: ["f1040.line9", "f1040.line10"],
        toleranceCents: 100n,
        description: "11 = 9 − 10",
      },
      {
        id: "1040.total_income",
        type: "sum",
        result: "f1040.line9",
        operands: [
          "f1040.line1a",
          "f1040.line2b",
          "f1040.line3b",
          "f1040.line4b",
          "f1040.line5b",
          "f1040.line6b",
          "f1040.line7",
          "f1040.line8",
        ],
        // 1040 line 9 also folds in 1b–1h edge lines we don't extract →
        // wider tolerance; a gate hit here routes to review, never blocks alone.
        toleranceCents: 10_000n,
        description: "9 ≈ Σ(1a, 2b..8)",
      },
    ],
    flows: [],
  },
  overrides: { 2024: {}, 2025: {} },
};

export const F1040_SCH_1: FormDefinition = {
  formFamily: "1040_SCH_1",
  baseYear: 2023,
  base: {
    fields: [
      money("f1040s1.line3", "3", "Business income or (loss) (Schedule C)", {
        taxonomyNodeKey: "pcf.income.business",
      }),
      money("f1040s1.line5", "5", "Rental real estate, partnerships, S corps (Schedule E)", {
        taxonomyNodeKey: "pcf.income.k1",
      }),
      money("f1040s1.line7", "7", "Unemployment compensation"),
      money("f1040s1.line9", "9", "Total other income"),
      money("f1040s1.line10", "10", "Additional income (to Form 1040, line 8)"),
      money("f1040s1.line25", "25", "Total adjustments", { pageHint: 2 }),
    ],
    relations: [],
    flows: [
      {
        id: "sch1.to_1040",
        fromField: "f1040s1.line10",
        toFamily: "1040",
        toField: "f1040.line8",
        toleranceCents: 0n,
        description: "Schedule 1 line 10 → 1040 line 8",
      },
    ],
  },
  overrides: { 2024: {}, 2025: {} },
};

export const F1040_SCH_C: FormDefinition = {
  formFamily: "1040_SCH_C",
  baseYear: 2023,
  base: {
    fields: [
      money("f1040sc.line1", "1", "Gross receipts or sales"),
      money("f1040sc.line2", "2", "Returns and allowances", { sign: -1 }),
      money("f1040sc.line3", "3", "Balance (1 minus 2)", {
        taxonomyNodeKey: "is.revenue.total",
      }),
      money("f1040sc.line4", "4", "Cost of goods sold", { taxonomyNodeKey: "is.cogs.total" }),
      money("f1040sc.line5", "5", "Gross profit", { taxonomyNodeKey: "is.gross_profit" }),
      money("f1040sc.line6", "6", "Other income"),
      money("f1040sc.line7", "7", "Gross income"),
      money("f1040sc.line13", "13", "Depreciation and section 179", {
        taxonomyNodeKey: "is.opex.depreciation",
      }),
      money("f1040sc.line16a", "16a", "Interest — mortgage", {
        taxonomyNodeKey: "is.other.interest_expense",
      }),
      money("f1040sc.line16b", "16b", "Interest — other", {
        taxonomyNodeKey: "is.other.interest_expense",
      }),
      money("f1040sc.line26", "26", "Wages", { taxonomyNodeKey: "is.opex.salaries_wages" }),
      money("f1040sc.line28", "28", "Total expenses", { taxonomyNodeKey: "is.opex.total" }),
      money("f1040sc.line29", "29", "Tentative profit or (loss)"),
      money("f1040sc.line30", "30", "Home office expense"),
      money("f1040sc.line31", "31", "Net profit or (loss)", {
        taxonomyNodeKey: "is.net_income",
      }),
    ],
    relations: [
      {
        id: "schc.balance",
        type: "difference",
        result: "f1040sc.line3",
        operands: ["f1040sc.line1", "f1040sc.line2"],
        toleranceCents: 100n,
        description: "3 = 1 − 2",
      },
      {
        id: "schc.gross_profit",
        type: "difference",
        result: "f1040sc.line5",
        operands: ["f1040sc.line3", "f1040sc.line4"],
        toleranceCents: 100n,
        description: "5 = 3 − 4",
      },
      {
        id: "schc.tentative",
        type: "difference",
        result: "f1040sc.line29",
        operands: ["f1040sc.line7", "f1040sc.line28"],
        toleranceCents: 100n,
        description: "29 = 7 − 28",
      },
      {
        id: "schc.net_profit",
        type: "difference",
        result: "f1040sc.line31",
        operands: ["f1040sc.line29", "f1040sc.line30"],
        toleranceCents: 100n,
        description: "31 = 29 − 30",
      },
    ],
    flows: [
      {
        id: "schc.to_sch1",
        fromField: "f1040sc.line31",
        toFamily: "1040_SCH_1",
        toField: "f1040s1.line3",
        toleranceCents: 0n,
        description: "Schedule C line 31 → Schedule 1 line 3",
      },
    ],
  },
  overrides: { 2024: {}, 2025: {} },
};

export const F1040_SCH_E: FormDefinition = {
  formFamily: "1040_SCH_E",
  baseYear: 2023,
  base: {
    fields: [
      money("f1040se.line3", "3", "Rents received", {
        taxonomyNodeKey: "pcf.income.rental",
      }),
      money("f1040se.line12", "12", "Mortgage interest paid to banks"),
      money("f1040se.line18", "18", "Depreciation expense or depletion"),
      money("f1040se.line20", "20", "Total expenses"),
      money("f1040se.line21", "21", "Income or (loss) per property"),
      money("f1040se.line26", "26", "Total rental real estate and royalty income", {
        taxonomyNodeKey: "pcf.income.rental",
      }),
    ],
    relations: [],
    flows: [],
  },
  overrides: { 2024: {}, 2025: {} },
};
