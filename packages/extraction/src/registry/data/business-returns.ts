/**
 * Business return registries: 1120-S, 1120, 1065 (tax years 2023–2025).
 *
 * ⚠️ 1120-S line numbering verified against real filed 2023/2024 returns
 * (see the §179D insertion below). 1120 and 1065 still carry unverified
 * numbering — [PRATIK]/M4.1 must check them against printed forms before
 * extraction trusts their line numbers.
 * Line numbers verified against the 2023 printed forms; 2024/2025 carried
 * the same numbering (empty overrides — the mechanism is there for when
 * the IRS renumbers). ⚠️ [PRATIK] reviews field lists against real
 * underwriting needs (task M4.1).
 */

import type { FormDefinition } from "../types.js";
import { money } from "./helpers.js";

export const F1120S: FormDefinition = {
  formFamily: "1120S",
  baseYear: 2023,
  base: {
    fields: [
      money("f1120s.line1a", "1a", "Gross receipts or sales"),
      money("f1120s.line1b", "1b", "Returns and allowances", { sign: -1 }),
      money("f1120s.line1c", "1c", "Balance (1a minus 1b)", {
        taxonomyNodeKey: "is.revenue.total",
      }),
      money("f1120s.line2", "2", "Cost of goods sold", {
        aliases: ["COGS", "Cost of goods sold (attach Form 1125-A)"],
        taxonomyNodeKey: "is.cogs.total",
      }),
      money("f1120s.line3", "3", "Gross profit", { taxonomyNodeKey: "is.gross_profit" }),
      money("f1120s.line4", "4", "Net gain (loss) from Form 4797", {
        taxonomyNodeKey: "is.other.gain_loss_asset_sales",
      }),
      money("f1120s.line5", "5", "Other income (loss)", {
        taxonomyNodeKey: "is.other.other_income",
      }),
      money("f1120s.line6", "6", "Total income (loss)"),
      money("f1120s.line7", "7", "Compensation of officers", {
        aliases: ["Officer compensation"],
        taxonomyNodeKey: "is.opex.officer_comp",
      }),
      money("f1120s.line8", "8", "Salaries and wages", {
        taxonomyNodeKey: "is.opex.salaries_wages",
      }),
      money("f1120s.line9", "9", "Repairs and maintenance", {
        taxonomyNodeKey: "is.opex.repairs_maintenance",
      }),
      money("f1120s.line10", "10", "Bad debts", { taxonomyNodeKey: "is.opex.bad_debt" }),
      money("f1120s.line11", "11", "Rents", { taxonomyNodeKey: "is.opex.rent" }),
      money("f1120s.line12", "12", "Taxes and licenses", {
        taxonomyNodeKey: "is.opex.other_taxes",
      }),
      money("f1120s.line13", "13", "Interest expense", {
        aliases: ["Interest (see instructions)"],
        taxonomyNodeKey: "is.other.interest_expense",
      }),
      money("f1120s.line14", "14", "Depreciation not claimed elsewhere", {
        aliases: ["Depreciation (attach Form 4562)"],
        taxonomyNodeKey: "is.opex.depreciation",
      }),
      money("f1120s.line15", "15", "Depletion"),
      money("f1120s.line16", "16", "Advertising", {
        taxonomyNodeKey: "is.opex.marketing_advertising",
      }),
      money("f1120s.line17", "17", "Pension, profit-sharing, etc., plans", {
        taxonomyNodeKey: "is.opex.retirement_plans",
      }),
      money("f1120s.line18", "18", "Employee benefit programs", {
        taxonomyNodeKey: "is.opex.employee_benefits",
      }),
      // 2023 revision inserted §179D at line 19 and renumbered everything
      // below it — verified against three REAL filed 2023/2024 returns
      // (2026-07-19; the base data previously carried pre-2023 numbering).
      // Field ids stay stable; printed line numbers tell the truth.
      money("f1120s.line19_energy", "19", "Energy efficient commercial buildings deduction", {
        taxonomyNodeKey: "is.opex.misc",
      }),
      money("f1120s.line19", "20", "Other deductions", { taxonomyNodeKey: "is.opex.misc" }),
      money("f1120s.line20", "21", "Total deductions", { taxonomyNodeKey: "is.opex.total" }),
      money("f1120s.line21", "22", "Ordinary business income (loss)", {
        taxonomyNodeKey: "is.net_income",
      }),
    ],
    relations: [
      {
        id: "1120s.balance",
        type: "difference",
        result: "f1120s.line1c",
        operands: ["f1120s.line1a", "f1120s.line1b"],
        toleranceCents: 100n,
        description: "1c = 1a − 1b",
      },
      {
        id: "1120s.gross_profit",
        type: "difference",
        result: "f1120s.line3",
        operands: ["f1120s.line1c", "f1120s.line2"],
        toleranceCents: 100n,
        description: "3 = 1c − 2",
      },
      {
        id: "1120s.total_income",
        type: "sum",
        result: "f1120s.line6",
        operands: ["f1120s.line3", "f1120s.line4", "f1120s.line5"],
        toleranceCents: 100n,
        description: "6 = 3 + 4 + 5",
      },
      {
        id: "1120s.total_deductions",
        type: "sum",
        result: "f1120s.line20",
        operands: [
          "f1120s.line7",
          "f1120s.line8",
          "f1120s.line9",
          "f1120s.line10",
          "f1120s.line11",
          "f1120s.line12",
          "f1120s.line13",
          "f1120s.line14",
          "f1120s.line15",
          "f1120s.line16",
          "f1120s.line17",
          "f1120s.line18",
          "f1120s.line19",
        ],
        toleranceCents: 100n,
        description: "20 = Σ(7..19)",
      },
      {
        id: "1120s.ordinary_income",
        type: "difference",
        result: "f1120s.line21",
        operands: ["f1120s.line6", "f1120s.line20"],
        toleranceCents: 100n,
        description: "21 = 6 − 20 (the blueprint's example relation)",
      },
    ],
    flows: [],
  },
  overrides: { 2024: {}, 2025: {} },
};

export const F1120: FormDefinition = {
  formFamily: "1120",
  baseYear: 2023,
  base: {
    fields: [
      money("f1120.line1a", "1a", "Gross receipts or sales"),
      money("f1120.line1b", "1b", "Returns and allowances", { sign: -1 }),
      money("f1120.line1c", "1c", "Balance (1a minus 1b)", {
        taxonomyNodeKey: "is.revenue.total",
      }),
      money("f1120.line2", "2", "Cost of goods sold", { taxonomyNodeKey: "is.cogs.total" }),
      money("f1120.line3", "3", "Gross profit", { taxonomyNodeKey: "is.gross_profit" }),
      money("f1120.line4", "4", "Dividends and inclusions", {
        taxonomyNodeKey: "is.other.dividend_income",
      }),
      money("f1120.line5", "5", "Interest income", {
        taxonomyNodeKey: "is.other.interest_income",
      }),
      money("f1120.line6", "6", "Gross rents", { taxonomyNodeKey: "is.revenue.rental_income" }),
      money("f1120.line7", "7", "Gross royalties"),
      money("f1120.line8", "8", "Capital gain net income"),
      money("f1120.line9", "9", "Net gain (loss) from Form 4797", {
        taxonomyNodeKey: "is.other.gain_loss_asset_sales",
      }),
      money("f1120.line10", "10", "Other income", {
        taxonomyNodeKey: "is.other.other_income",
      }),
      money("f1120.line11", "11", "Total income"),
      money("f1120.line12", "12", "Compensation of officers", {
        taxonomyNodeKey: "is.opex.officer_comp",
      }),
      money("f1120.line13", "13", "Salaries and wages", {
        taxonomyNodeKey: "is.opex.salaries_wages",
      }),
      money("f1120.line14", "14", "Repairs and maintenance", {
        taxonomyNodeKey: "is.opex.repairs_maintenance",
      }),
      money("f1120.line15", "15", "Bad debts", { taxonomyNodeKey: "is.opex.bad_debt" }),
      money("f1120.line16", "16", "Rents", { taxonomyNodeKey: "is.opex.rent" }),
      money("f1120.line17", "17", "Taxes and licenses", {
        taxonomyNodeKey: "is.opex.other_taxes",
      }),
      money("f1120.line18", "18", "Interest expense", {
        taxonomyNodeKey: "is.other.interest_expense",
      }),
      money("f1120.line19", "19", "Charitable contributions", {
        taxonomyNodeKey: "is.opex.charitable",
      }),
      money("f1120.line20", "20", "Depreciation from Form 4562", {
        taxonomyNodeKey: "is.opex.depreciation",
      }),
      money("f1120.line21", "21", "Depletion"),
      money("f1120.line22", "22", "Advertising", {
        taxonomyNodeKey: "is.opex.marketing_advertising",
      }),
      money("f1120.line23", "23", "Pension, profit-sharing, etc., plans", {
        taxonomyNodeKey: "is.opex.retirement_plans",
      }),
      money("f1120.line24", "24", "Employee benefit programs", {
        taxonomyNodeKey: "is.opex.employee_benefits",
      }),
      money("f1120.line26", "26", "Other deductions", { taxonomyNodeKey: "is.opex.misc" }),
      money("f1120.line27", "27", "Total deductions", { taxonomyNodeKey: "is.opex.total" }),
      money("f1120.line28", "28", "Taxable income before NOL deduction", {
        taxonomyNodeKey: "is.pretax_income",
      }),
      money("f1120.line30", "30", "Taxable income"),
      money("f1120.line31", "31", "Total tax", { taxonomyNodeKey: "is.income_tax" }),
    ],
    relations: [
      {
        id: "1120.total_income",
        type: "sum",
        result: "f1120.line11",
        operands: [
          "f1120.line3",
          "f1120.line4",
          "f1120.line5",
          "f1120.line6",
          "f1120.line7",
          "f1120.line8",
          "f1120.line9",
          "f1120.line10",
        ],
        toleranceCents: 100n,
        description: "11 = Σ(3..10)",
      },
      {
        id: "1120.taxable_before_nol",
        type: "difference",
        result: "f1120.line28",
        operands: ["f1120.line11", "f1120.line27"],
        toleranceCents: 100n,
        description: "28 = 11 − 27",
      },
    ],
    flows: [],
  },
  overrides: { 2024: {}, 2025: {} },
};

export const F1065: FormDefinition = {
  formFamily: "1065",
  baseYear: 2023,
  base: {
    fields: [
      money("f1065.line1a", "1a", "Gross receipts or sales"),
      money("f1065.line1b", "1b", "Returns and allowances", { sign: -1 }),
      money("f1065.line1c", "1c", "Balance (1a minus 1b)", {
        taxonomyNodeKey: "is.revenue.total",
      }),
      money("f1065.line2", "2", "Cost of goods sold", { taxonomyNodeKey: "is.cogs.total" }),
      money("f1065.line3", "3", "Gross profit", { taxonomyNodeKey: "is.gross_profit" }),
      money("f1065.line4", "4", "Ordinary income (loss) from other partnerships"),
      money("f1065.line5", "5", "Net farm profit (loss)"),
      money("f1065.line6", "6", "Net gain (loss) from Form 4797", {
        taxonomyNodeKey: "is.other.gain_loss_asset_sales",
      }),
      money("f1065.line7", "7", "Other income (loss)", {
        taxonomyNodeKey: "is.other.other_income",
      }),
      money("f1065.line8", "8", "Total income (loss)"),
      money("f1065.line9", "9", "Salaries and wages", {
        taxonomyNodeKey: "is.opex.salaries_wages",
      }),
      money("f1065.line10", "10", "Guaranteed payments to partners", {
        taxonomyNodeKey: "is.opex.officer_comp",
      }),
      money("f1065.line11", "11", "Repairs and maintenance", {
        taxonomyNodeKey: "is.opex.repairs_maintenance",
      }),
      money("f1065.line12", "12", "Bad debts", { taxonomyNodeKey: "is.opex.bad_debt" }),
      money("f1065.line13", "13", "Rent", { taxonomyNodeKey: "is.opex.rent" }),
      money("f1065.line14", "14", "Taxes and licenses", {
        taxonomyNodeKey: "is.opex.other_taxes",
      }),
      money("f1065.line15", "15", "Interest expense", {
        taxonomyNodeKey: "is.other.interest_expense",
      }),
      money("f1065.line16a", "16a", "Depreciation", {
        aliases: ["Depreciation (if required, attach Form 4562)"],
        taxonomyNodeKey: "is.opex.depreciation",
      }),
      money("f1065.line17", "17", "Depletion"),
      money("f1065.line18", "18", "Retirement plans, etc.", {
        taxonomyNodeKey: "is.opex.retirement_plans",
      }),
      money("f1065.line19", "19", "Employee benefit programs", {
        taxonomyNodeKey: "is.opex.employee_benefits",
      }),
      money("f1065.line20", "20", "Other deductions", { taxonomyNodeKey: "is.opex.misc" }),
      money("f1065.line21", "21", "Total deductions", { taxonomyNodeKey: "is.opex.total" }),
      money("f1065.line22", "22", "Ordinary business income (loss)", {
        taxonomyNodeKey: "is.net_income",
      }),
    ],
    relations: [
      {
        id: "1065.gross_profit",
        type: "difference",
        result: "f1065.line3",
        operands: ["f1065.line1c", "f1065.line2"],
        toleranceCents: 100n,
        description: "3 = 1c − 2",
      },
      {
        id: "1065.total_income",
        type: "sum",
        result: "f1065.line8",
        operands: ["f1065.line3", "f1065.line4", "f1065.line5", "f1065.line6", "f1065.line7"],
        toleranceCents: 100n,
        description: "8 = Σ(3..7)",
      },
      {
        id: "1065.total_deductions",
        type: "sum",
        result: "f1065.line21",
        operands: [
          "f1065.line9",
          "f1065.line10",
          "f1065.line11",
          "f1065.line12",
          "f1065.line13",
          "f1065.line14",
          "f1065.line15",
          "f1065.line16a",
          "f1065.line17",
          "f1065.line18",
          "f1065.line19",
          "f1065.line20",
        ],
        toleranceCents: 100n,
        description: "21 = Σ(9..20)",
      },
      {
        id: "1065.ordinary_income",
        type: "difference",
        result: "f1065.line22",
        operands: ["f1065.line8", "f1065.line21"],
        toleranceCents: 100n,
        description: "22 = 8 − 21",
      },
    ],
    flows: [],
  },
  overrides: { 2024: {}, 2025: {} },
};
