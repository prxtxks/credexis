/**
 * Business return registries: 1120-S, 1120, 1065 (tax years 2020–2025).
 *
 * Numbering provenance (all against official printed PDFs in corpus-1):
 * - 1120-S: 2023/2024 verified against real filed returns (2026-07-19);
 *   TY 2020-2022 pre-§179D numbering verified against the 2019/2021
 *   revisions (2026-08-05).
 * - 1065: 2023 §179D insertion and TY 2020-2022 numbering verified
 *   against the 2019/2021/2023 revisions (2026-08-05 - the base data
 *   previously carried pre-2023 numbering for 2023, now corrected).
 * - 1120: TY 2020-2025 verified stable for every mapped line (2026-08-05).
 * - Schedule L: identical across all supported years for all three forms.
 * ⚠️ [PRATIK] reviews field lists against real underwriting needs (M4.1).
 */

import type { FormDefinition, RegistryField } from "../types.js";
import { identityText, money } from "./helpers.js";

/**
 * Schedule L line, END-OF-YEAR column only (M13.4, walkthrough P2-1).
 * The schedule prints four columns; these fields read column (d) - the
 * balance sheet as of the return's fiscal year end, the same period the
 * rest of the return binds to. Column (b) is the PRIOR year's closing
 * balance sheet: a different period, deliberately not extracted - a
 * prior-year upload is the honest source for it. Line numbering verified
 * against the official 2023 printed forms (corpus-1 PDFs, 2026-07-31):
 * 1120 p6, 1120-S p4, 1065 Schedule L page; the three forms number their
 * liability/equity sections differently.
 */
const SCH_L_HINT =
  "Schedule L prints four columns: (a)/(b) beginning of tax year, (c)/(d) end of tax year. " +
  "Read ONLY column (d), end of tax year - never columns (a) through (c).";

/**
 * Back-year derivation (M14.4): the 2023 revisions inserted the §179D
 * energy deduction (1120-S line 19, 1065 line 20) and shifted every line
 * below it by one. TY 2020-2022 (the 2019/2021 printed revisions - both
 * verified line-by-line against corpus-1 PDFs, 2026-08-05) share ONE
 * stable pre-§179D numbering, so back years are the base minus the energy
 * field with the shifted lines renumbered. Field ids never change - they
 * are identity; only the PRINTED line number differs by year.
 */
function preEnergyFields(
  fields: RegistryField[],
  energyFieldId: string,
  renumber: Record<string, string>,
): RegistryField[] {
  return fields
    .filter((f) => f.fieldId !== energyFieldId)
    .map((f) => {
      const to = renumber[f.lineNumber];
      return to === undefined ? f : { ...f, lineNumber: to };
    });
}

function schL(
  fieldId: string,
  lineNumber: string,
  label: string,
  taxonomyNodeKey: string | null,
  pageHint: number,
  opts: Partial<Omit<RegistryField, "fieldId" | "lineNumber" | "label" | "dtype">> = {},
): RegistryField {
  return money(fieldId, lineNumber, `Schedule L: ${label} (end of year)`, {
    pageHint,
    hasCentsBox: false,
    hint: SCH_L_HINT,
    taxonomyNodeKey,
    ...opts,
  });
}

const F1120S_BASE: FormDefinition["base"] = {
  fields: [
    identityText("f1120s.corp_name", "Name of corporation (as printed at the top of Form 1120-S)"),
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
    money("f1120s.line6", "6", "Total income (loss)", { taxonomyNodeKey: "is.operating_income" }),
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
    money("f1120s.line15", "15", "Depletion", { taxonomyNodeKey: "is.opex.misc" }),
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
    // ── Schedule L (printed page 4) - see SCH_L_HINT ──
    schL("f1120s.schl_line1", "L1", "Cash", "bs.assets.current.cash", 4),
    schL(
      "f1120s.schl_line2b",
      "L2b",
      "Trade notes and accounts receivable, net of allowance",
      "bs.assets.current.accounts_receivable",
      4,
    ),
    schL("f1120s.schl_line3", "L3", "Inventories", "bs.assets.current.inventory", 4),
    schL(
      "f1120s.schl_line4",
      "L4",
      "U.S. government obligations",
      "bs.assets.other.investments",
      4,
    ),
    schL("f1120s.schl_line5", "L5", "Tax-exempt securities", "bs.assets.other.investments", 4),
    schL("f1120s.schl_line6", "L6", "Other current assets", "bs.assets.current.other", 4),
    schL(
      "f1120s.schl_line7",
      "L7",
      "Loans to shareholders",
      "bs.assets.other.due_from_shareholders",
      4,
    ),
    schL(
      "f1120s.schl_line8",
      "L8",
      "Mortgage and real estate loans",
      "bs.assets.other.notes_receivable_lt",
      4,
    ),
    schL("f1120s.schl_line9", "L9", "Other investments", "bs.assets.other.investments", 4),
    schL(
      "f1120s.schl_line10b",
      "L10b",
      "Buildings and other depreciable assets, net of accumulated depreciation",
      "bs.assets.fixed.total",
      4,
    ),
    schL("f1120s.schl_line12", "L12", "Land", "bs.assets.fixed.land", 4),
    schL(
      "f1120s.schl_line13b",
      "L13b",
      "Intangible assets, net of accumulated amortization",
      "bs.assets.other.intangibles",
      4,
    ),
    schL("f1120s.schl_line14", "L14", "Other assets", "bs.assets.other.other", 4),
    schL("f1120s.schl_line15", "L15", "Total assets", "bs.assets.total", 4),
    schL(
      "f1120s.schl_line16",
      "L16",
      "Accounts payable",
      "bs.liabilities.current.accounts_payable",
      4,
    ),
    schL(
      "f1120s.schl_line17",
      "L17",
      "Mortgages, notes, bonds payable in less than 1 year",
      "bs.liabilities.current.current_portion_ltd",
      4,
    ),
    schL(
      "f1120s.schl_line18",
      "L18",
      "Other current liabilities",
      "bs.liabilities.current.other",
      4,
    ),
    schL(
      "f1120s.schl_line19",
      "L19",
      "Loans from shareholders",
      "bs.liabilities.longterm.stockholder_loans",
      4,
    ),
    schL(
      "f1120s.schl_line20",
      "L20",
      "Mortgages, notes, bonds payable in 1 year or more",
      "bs.liabilities.longterm.notes_payable",
      4,
    ),
    schL("f1120s.schl_line21", "L21", "Other liabilities", "bs.liabilities.longterm.other", 4),
    schL("f1120s.schl_line22", "L22", "Capital stock", "bs.equity.common_stock", 4),
    schL("f1120s.schl_line23", "L23", "Additional paid-in capital", "bs.equity.paid_in_capital", 4),
    schL("f1120s.schl_line24", "L24", "Retained earnings", "bs.equity.retained_earnings", 4),
    schL("f1120s.schl_line25", "L25", "Adjustments to shareholders' equity", "bs.equity.other", 4),
    schL(
      "f1120s.schl_line26",
      "L26",
      "Less cost of treasury stock",
      "bs.equity.treasury_stock",
      4,
      {
        sign: -1,
      },
    ),
    schL(
      "f1120s.schl_line27",
      "L27",
      "Total liabilities and shareholders' equity",
      "bs.total_liabilities_equity",
      4,
    ),
  ],
  relations: [
    {
      id: "1120s.schl_balances",
      type: "sum",
      result: "f1120s.schl_line27",
      operands: ["f1120s.schl_line15"],
      toleranceCents: 100n,
      description: "Schedule L balances: total liabilities & equity (L27) = total assets (L15)",
    },
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
        "f1120s.line19_energy",
        "f1120s.line19",
      ],
      toleranceCents: 100n,
      description: "21 = Σ(7..20) on the printed 2023 form (includes §179D)",
    },
    {
      id: "1120s.ordinary_income",
      type: "difference",
      result: "f1120s.line21",
      operands: ["f1120s.line6", "f1120s.line20"],
      toleranceCents: 100n,
      description: "22 = 6 − 21 (the blueprint's example relation)",
    },
  ],
  flows: [],
};

/** TY 2020-2022: no §179D line; Other/Total/OBI print one line higher. */
const F1120S_PRE2023: NonNullable<FormDefinition["overrides"]>[number] = {
  fields: preEnergyFields(F1120S_BASE.fields, "f1120s.line19_energy", {
    "20": "19",
    "21": "20",
    "22": "21",
  }),
  relations: F1120S_BASE.relations.map((r) =>
    r.id === "1120s.total_deductions"
      ? {
          ...r,
          operands: r.operands.filter((o) => o !== "f1120s.line19_energy"),
          description: "20 = Σ(7..19) (pre-§179D printed form)",
        }
      : r.id === "1120s.ordinary_income"
        ? { ...r, description: "21 = 6 − 20 (pre-§179D printed form)" }
        : r,
  ),
};

export const F1120S: FormDefinition = {
  formFamily: "1120S",
  baseYear: 2023,
  base: F1120S_BASE,
  overrides: {
    2020: F1120S_PRE2023,
    2021: F1120S_PRE2023,
    2022: F1120S_PRE2023,
    2024: {},
    2025: {},
  },
};

export const F1120: FormDefinition = {
  formFamily: "1120",
  baseYear: 2023,
  base: {
    fields: [
      identityText("f1120.corp_name", "Name of corporation (as printed at the top of Form 1120)"),
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
      money("f1120.line7", "7", "Gross royalties", { taxonomyNodeKey: "is.other.other_income" }),
      money("f1120.line8", "8", "Capital gain net income", {
        taxonomyNodeKey: "is.other.gain_loss_asset_sales",
      }),
      money("f1120.line9", "9", "Net gain (loss) from Form 4797", {
        taxonomyNodeKey: "is.other.gain_loss_asset_sales",
      }),
      money("f1120.line10", "10", "Other income", {
        taxonomyNodeKey: "is.other.other_income",
      }),
      money("f1120.line11", "11", "Total income", { taxonomyNodeKey: "is.operating_income" }),
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
      money("f1120.line21", "21", "Depletion", { taxonomyNodeKey: "is.opex.misc" }),
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
      money("f1120.line30", "30", "Taxable income", { taxonomyNodeKey: "is.pretax_income" }),
      money("f1120.line31", "31", "Total tax", { taxonomyNodeKey: "is.income_tax" }),
      // ── Schedule L (printed page 6) - see SCH_L_HINT ──
      schL("f1120.schl_line1", "L1", "Cash", "bs.assets.current.cash", 6),
      schL(
        "f1120.schl_line2b",
        "L2b",
        "Trade notes and accounts receivable, net of allowance",
        "bs.assets.current.accounts_receivable",
        6,
      ),
      schL("f1120.schl_line3", "L3", "Inventories", "bs.assets.current.inventory", 6),
      schL(
        "f1120.schl_line4",
        "L4",
        "U.S. government obligations",
        "bs.assets.other.investments",
        6,
      ),
      schL("f1120.schl_line5", "L5", "Tax-exempt securities", "bs.assets.other.investments", 6),
      schL("f1120.schl_line6", "L6", "Other current assets", "bs.assets.current.other", 6),
      schL(
        "f1120.schl_line7",
        "L7",
        "Loans to shareholders",
        "bs.assets.other.due_from_shareholders",
        6,
      ),
      schL(
        "f1120.schl_line8",
        "L8",
        "Mortgage and real estate loans",
        "bs.assets.other.notes_receivable_lt",
        6,
      ),
      schL("f1120.schl_line9", "L9", "Other investments", "bs.assets.other.investments", 6),
      schL(
        "f1120.schl_line10b",
        "L10b",
        "Buildings and other depreciable assets, net of accumulated depreciation",
        "bs.assets.fixed.total",
        6,
      ),
      schL("f1120.schl_line12", "L12", "Land", "bs.assets.fixed.land", 6),
      schL(
        "f1120.schl_line13b",
        "L13b",
        "Intangible assets, net of accumulated amortization",
        "bs.assets.other.intangibles",
        6,
      ),
      schL("f1120.schl_line14", "L14", "Other assets", "bs.assets.other.other", 6),
      schL("f1120.schl_line15", "L15", "Total assets", "bs.assets.total", 6),
      schL(
        "f1120.schl_line16",
        "L16",
        "Accounts payable",
        "bs.liabilities.current.accounts_payable",
        6,
      ),
      schL(
        "f1120.schl_line17",
        "L17",
        "Mortgages, notes, bonds payable in less than 1 year",
        "bs.liabilities.current.current_portion_ltd",
        6,
      ),
      schL(
        "f1120.schl_line18",
        "L18",
        "Other current liabilities",
        "bs.liabilities.current.other",
        6,
      ),
      schL(
        "f1120.schl_line19",
        "L19",
        "Loans from shareholders",
        "bs.liabilities.longterm.stockholder_loans",
        6,
      ),
      schL(
        "f1120.schl_line20",
        "L20",
        "Mortgages, notes, bonds payable in 1 year or more",
        "bs.liabilities.longterm.notes_payable",
        6,
      ),
      schL("f1120.schl_line21", "L21", "Other liabilities", "bs.liabilities.longterm.other", 6),
      schL(
        "f1120.schl_line22a",
        "L22a",
        "Capital stock: preferred stock",
        "bs.equity.preferred_stock",
        6,
      ),
      schL(
        "f1120.schl_line22b",
        "L22b",
        "Capital stock: common stock",
        "bs.equity.common_stock",
        6,
      ),
      schL(
        "f1120.schl_line23",
        "L23",
        "Additional paid-in capital",
        "bs.equity.paid_in_capital",
        6,
      ),
      schL(
        "f1120.schl_line24",
        "L24",
        "Retained earnings, appropriated",
        "bs.equity.retained_earnings",
        6,
      ),
      schL(
        "f1120.schl_line25",
        "L25",
        "Retained earnings, unappropriated",
        "bs.equity.retained_earnings",
        6,
      ),
      schL("f1120.schl_line26", "L26", "Adjustments to shareholders' equity", "bs.equity.other", 6),
      schL(
        "f1120.schl_line27",
        "L27",
        "Less cost of treasury stock",
        "bs.equity.treasury_stock",
        6,
        {
          sign: -1,
        },
      ),
      schL(
        "f1120.schl_line28",
        "L28",
        "Total liabilities and shareholders' equity",
        "bs.total_liabilities_equity",
        6,
      ),
    ],
    relations: [
      {
        id: "1120.schl_balances",
        type: "sum",
        result: "f1120.schl_line28",
        operands: ["f1120.schl_line15"],
        toleranceCents: 100n,
        description: "Schedule L balances: total liabilities & equity (L28) = total assets (L15)",
      },
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
  // TY 2020-2022 verified stable against the printed 2019/2021 revisions
  // (M14.4): every mapped page-1 line (≤31) and all of Schedule L are
  // identical; only line 32+ changed in 2023, outside the mapped range.
  overrides: { 2020: {}, 2021: {}, 2022: {}, 2024: {}, 2025: {} },
};

const F1065_BASE: FormDefinition["base"] = {
  fields: [
    identityText(
      "f1065.partnership_name",
      "Name of partnership (as printed at the top of Form 1065)",
    ),
    money("f1065.line1a", "1a", "Gross receipts or sales"),
    money("f1065.line1b", "1b", "Returns and allowances", { sign: -1 }),
    money("f1065.line1c", "1c", "Balance (1a minus 1b)", {
      taxonomyNodeKey: "is.revenue.total",
    }),
    money("f1065.line2", "2", "Cost of goods sold", { taxonomyNodeKey: "is.cogs.total" }),
    money("f1065.line3", "3", "Gross profit", { taxonomyNodeKey: "is.gross_profit" }),
    money("f1065.line4", "4", "Ordinary income (loss) from other partnerships", {
      taxonomyNodeKey: "is.other.other_income",
    }),
    money("f1065.line5", "5", "Net farm profit (loss)", {
      taxonomyNodeKey: "is.other.other_income",
    }),
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
    // 2023 revision inserted §179D at line 20 and renumbered everything
    // below (verified against the printed 2021 vs 2023 forms, corpus-1,
    // 2026-08-05 - the base data previously carried pre-2023 numbering).
    // Field ids stay stable; printed line numbers tell the truth.
    money("f1065.line20_energy", "20", "Energy efficient commercial buildings deduction", {
      taxonomyNodeKey: "is.opex.misc",
    }),
    money("f1065.line20", "21", "Other deductions", { taxonomyNodeKey: "is.opex.misc" }),
    money("f1065.line21", "22", "Total deductions", { taxonomyNodeKey: "is.opex.total" }),
    money("f1065.line22", "23", "Ordinary business income (loss)", {
      taxonomyNodeKey: "is.net_income",
    }),
    // ── Schedule L - see SCH_L_HINT. The 1065 numbers its schedule
    //    differently from the 1120 family (assets end at 14, partners'
    //    capital replaces the equity block) - verified against the
    //    official 2023 form. ──
    schL("f1065.schl_line1", "L1", "Cash", "bs.assets.current.cash", 6),
    schL(
      "f1065.schl_line2b",
      "L2b",
      "Trade notes and accounts receivable, net of allowance",
      "bs.assets.current.accounts_receivable",
      6,
    ),
    schL("f1065.schl_line3", "L3", "Inventories", "bs.assets.current.inventory", 6),
    schL("f1065.schl_line4", "L4", "U.S. government obligations", "bs.assets.other.investments", 6),
    schL("f1065.schl_line5", "L5", "Tax-exempt securities", "bs.assets.other.investments", 6),
    schL("f1065.schl_line6", "L6", "Other current assets", "bs.assets.current.other", 6),
    schL("f1065.schl_line7a", "L7a", "Loans to partners", "bs.assets.other.due_from_related", 6),
    schL(
      "f1065.schl_line7b",
      "L7b",
      "Mortgage and real estate loans",
      "bs.assets.other.notes_receivable_lt",
      6,
    ),
    schL("f1065.schl_line8", "L8", "Other investments", "bs.assets.other.investments", 6),
    schL(
      "f1065.schl_line9b",
      "L9b",
      "Buildings and other depreciable assets, net of accumulated depreciation",
      "bs.assets.fixed.total",
      6,
    ),
    schL("f1065.schl_line11", "L11", "Land", "bs.assets.fixed.land", 6),
    schL(
      "f1065.schl_line12b",
      "L12b",
      "Intangible assets, net of accumulated amortization",
      "bs.assets.other.intangibles",
      6,
    ),
    schL("f1065.schl_line13", "L13", "Other assets", "bs.assets.other.other", 6),
    schL("f1065.schl_line14", "L14", "Total assets", "bs.assets.total", 6),
    schL(
      "f1065.schl_line15",
      "L15",
      "Accounts payable",
      "bs.liabilities.current.accounts_payable",
      6,
    ),
    schL(
      "f1065.schl_line16",
      "L16",
      "Mortgages, notes, bonds payable in less than 1 year",
      "bs.liabilities.current.current_portion_ltd",
      6,
    ),
    schL(
      "f1065.schl_line17",
      "L17",
      "Other current liabilities",
      "bs.liabilities.current.other",
      6,
    ),
    schL("f1065.schl_line18", "L18", "All nonrecourse loans", "bs.liabilities.longterm.other", 6),
    schL(
      "f1065.schl_line19a",
      "L19a",
      "Loans from partners",
      "bs.liabilities.longterm.due_to_related",
      6,
    ),
    schL(
      "f1065.schl_line19b",
      "L19b",
      "Mortgages, notes, bonds payable in 1 year or more",
      "bs.liabilities.longterm.notes_payable",
      6,
    ),
    schL("f1065.schl_line20", "L20", "Other liabilities", "bs.liabilities.longterm.other", 6),
    schL("f1065.schl_line21", "L21", "Partners' capital accounts", "bs.equity.partner_capital", 6),
    schL(
      "f1065.schl_line22",
      "L22",
      "Total liabilities and capital",
      "bs.total_liabilities_equity",
      6,
    ),
  ],
  relations: [
    {
      id: "1065.schl_balances",
      type: "sum",
      result: "f1065.schl_line22",
      operands: ["f1065.schl_line14"],
      toleranceCents: 100n,
      description: "Schedule L balances: total liabilities & capital (L22) = total assets (L14)",
    },
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
        "f1065.line20_energy",
        "f1065.line20",
      ],
      toleranceCents: 100n,
      description: "22 = Σ(9..21) on the printed 2023 form (includes §179D)",
    },
    {
      id: "1065.ordinary_income",
      type: "difference",
      result: "f1065.line22",
      operands: ["f1065.line8", "f1065.line21"],
      toleranceCents: 100n,
      description: "23 = 8 − 22",
    },
  ],
  flows: [],
};

/** TY 2020-2022: no §179D line; Other/Total/OBI print one line higher. */
const F1065_PRE2023: NonNullable<FormDefinition["overrides"]>[number] = {
  fields: preEnergyFields(F1065_BASE.fields, "f1065.line20_energy", {
    "21": "20",
    "22": "21",
    "23": "22",
  }),
  relations: F1065_BASE.relations.map((r) =>
    r.id === "1065.total_deductions"
      ? {
          ...r,
          operands: r.operands.filter((o) => o !== "f1065.line20_energy"),
          description: "21 = Σ(9..20) (pre-§179D printed form)",
        }
      : r.id === "1065.ordinary_income"
        ? { ...r, description: "22 = 8 − 21 (pre-§179D printed form)" }
        : r,
  ),
};

export const F1065: FormDefinition = {
  formFamily: "1065",
  baseYear: 2023,
  base: F1065_BASE,
  overrides: {
    2020: F1065_PRE2023,
    2021: F1065_PRE2023,
    2022: F1065_PRE2023,
    2024: {},
    2025: {},
  },
};
