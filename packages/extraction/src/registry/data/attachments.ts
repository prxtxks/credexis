/**
 * Attachment/schedule registries: 4562, 8825, 1125-E, K-1 (1120-S & 1065),
 * W-2 (tax years 2023–2025). The 4562→parent flows are the Blueprint §4.2
 * flagship example ("f4562.line22 → flows to 1120S.line14").
 * ⚠️ [PRATIK] reviews field lists against real underwriting needs (M4.1).
 */

import type { FormDefinition } from "../types.js";
import { identityText, money, yearVariant } from "./helpers.js";

export const F4562: FormDefinition = {
  formFamily: "4562",
  baseYear: 2023,
  base: {
    fields: [
      money("f4562.line12", "12", "Section 179 expense deduction"),
      money("f4562.line14", "14", "Special depreciation allowance"),
      money("f4562.line17", "17", "MACRS deductions for prior-year assets"),
      money("f4562.line22", "22", "Total depreciation and amortization", {
        aliases: ["Total. Add amounts from line 12, lines 14 through 17"],
        taxonomyNodeKey: "is.opex.depreciation",
      }),
    ],
    relations: [],
    flows: [
      {
        id: "4562.to_1120s",
        fromField: "f4562.line22",
        toFamily: "1120S",
        toField: "f1120s.line14",
        toleranceCents: 0n,
        description: "4562 line 22 → 1120-S line 14 (the blueprint's example)",
      },
      {
        id: "4562.to_1120",
        fromField: "f4562.line22",
        toFamily: "1120",
        toField: "f1120.line20",
        toleranceCents: 0n,
        description: "4562 line 22 → 1120 line 20",
      },
      {
        id: "4562.to_1065",
        fromField: "f4562.line22",
        toFamily: "1065",
        toField: "f1065.line16a",
        toleranceCents: 0n,
        description: "4562 line 22 → 1065 line 16a",
      },
    ],
  },
  overrides: { 2020: {}, 2021: {}, 2022: {}, 2024: {}, 2025: {} },
};

const F8825_BASE: FormDefinition["base"] = {
  fields: [
    money("f8825.line2", "2", "Gross rents", {
      taxonomyNodeKey: "is.revenue.rental_income",
    }),
    money("f8825.line14", "14", "Depreciation", {
      taxonomyNodeKey: "is.opex.depreciation",
    }),
    money("f8825.line16", "16", "Total expenses per property"),
    money("f8825.line17", "17", "Income or (loss) per property"),
    money("f8825.line21", "21", "Net rental real estate income (loss)", {
      taxonomyNodeKey: "is.other.rental_income_nonop",
    }),
  ],
  relations: [],
  flows: [],
};

/** The December 2025 revision renumbered the tail (corpus f8825-current
 *  vs f8825-2018, 2026-08-12): 15/16 became Reserved, 17 = Other
 *  deductions, so Total expenses prints at 18, Income/(loss) at 19, and
 *  Net rental real estate at 23. TY2020-2024 use the stable Nov-2018
 *  revision - the base numbering. */
const F8825_2025 = {
  fields: yearVariant(F8825_BASE.fields, {
    renumber: { "f8825.line16": "18", "f8825.line17": "19", "f8825.line21": "23" },
  }),
};

export const F8825: FormDefinition = {
  formFamily: "8825",
  baseYear: 2023,
  base: F8825_BASE,
  overrides: { 2020: {}, 2021: {}, 2022: {}, 2024: {}, 2025: F8825_2025 },
};

export const F1125E: FormDefinition = {
  formFamily: "1125E",
  baseYear: 2023,
  base: {
    fields: [
      money("f1125e.line2", "2", "Total compensation of officers", {
        taxonomyNodeKey: "is.opex.officer_comp",
      }),
      money("f1125e.line3", "3", "Compensation claimed on Form 1125-A or elsewhere", {
        sign: -1,
      }),
      money("f1125e.line4", "4", "Subtract line 3 from line 2 (to tax return)", {
        taxonomyNodeKey: "is.opex.officer_comp",
      }),
    ],
    relations: [
      {
        id: "1125e.net_comp",
        type: "difference",
        result: "f1125e.line4",
        operands: ["f1125e.line2", "f1125e.line3"],
        toleranceCents: 100n,
        description: "4 = 2 − 3",
      },
    ],
    flows: [
      {
        id: "1125e.to_1120s",
        fromField: "f1125e.line4",
        toFamily: "1120S",
        toField: "f1120s.line7",
        toleranceCents: 0n,
        description: "1125-E line 4 → 1120-S line 7",
      },
      {
        id: "1125e.to_1120",
        fromField: "f1125e.line4",
        toFamily: "1120",
        toField: "f1120.line12",
        toleranceCents: 0n,
        description: "1125-E line 4 → 1120 line 12",
      },
    ],
  },
  overrides: { 2020: {}, 2021: {}, 2022: {}, 2024: {}, 2025: {} },
};

export const K1_1120S: FormDefinition = {
  formFamily: "K1_1120S",
  baseYear: 2023,
  base: {
    fields: [
      identityText(
        "k1s.shareholder_name",
        "Shareholder's name (Part II item F1 of Schedule K-1)",
        "The individual shareholder's printed name — not the corporation in Part I.",
      ),
      money("k1s.box1", "1", "Ordinary business income (loss)", {
        taxonomyNodeKey: "pcf.income.k1",
      }),
      money("k1s.box2", "2", "Net rental real estate income (loss)", {
        taxonomyNodeKey: "pcf.income.rental",
      }),
      money("k1s.box4", "4", "Interest income", {
        taxonomyNodeKey: "pcf.income.interest_dividends",
      }),
      money("k1s.box5a", "5a", "Ordinary dividends", {
        taxonomyNodeKey: "pcf.income.interest_dividends",
      }),
      money("k1s.box11", "11", "Section 179 deduction", {
        // Real-corpus finding (2026-07-20): box 17 code AC's amount prints
        // in the same visual band; without a box-17 field the vendor
        // stuffed it here. Box 11 must be the amount in box 11 itself.
        aliases: ["Section 179 expense deduction"],
        hint:
          "Only an amount printed INSIDE box 11. Box 17 'Other information' " +
          "prints code-lettered amounts (V, AC, ...) in the adjacent column on " +
          "the same row band — those belong to box 17, never box 11. " +
          "If box 11 itself is blank, return empty.",
      }),
      money("k1s.box16d", "16 (code D)", "Distributions", {
        aliases: ["Items affecting shareholder basis — D"],
        taxonomyNodeKey: "pcf.income.k1_distributions",
      }),
      // Registry-only (no taxonomy): §448(c) gross receipts — useful for
      // SBA size-standard checks, never a cash-flow input.
      money("k1s.box17ac", "17 (code AC)", "Gross receipts for section 448(c)", {
        aliases: ["Other information — AC", "Gross receipts for section 448(c)"],
      }),
    ],
    relations: [],
    flows: [],
  },
  overrides: { 2020: {}, 2021: {}, 2022: {}, 2024: {}, 2025: {} },
};

export const K1_1065: FormDefinition = {
  formFamily: "K1_1065",
  baseYear: 2023,
  base: {
    fields: [
      money("k1p.box1", "1", "Ordinary business income (loss)", {
        taxonomyNodeKey: "pcf.income.k1",
      }),
      money("k1p.box2", "2", "Net rental real estate income (loss)", {
        taxonomyNodeKey: "pcf.income.rental",
      }),
      money("k1p.box4c", "4c", "Total guaranteed payments", {
        taxonomyNodeKey: "pcf.income.k1",
      }),
      money("k1p.box5", "5", "Interest income", {
        taxonomyNodeKey: "pcf.income.interest_dividends",
      }),
      money("k1p.box6a", "6a", "Ordinary dividends", {
        taxonomyNodeKey: "pcf.income.interest_dividends",
      }),
      money("k1p.box12", "12", "Section 179 deduction"),
      money("k1p.box19a", "19 (code A)", "Distributions — cash and marketable securities", {
        taxonomyNodeKey: "pcf.income.k1_distributions",
      }),
    ],
    relations: [],
    flows: [],
  },
  overrides: { 2020: {}, 2021: {}, 2022: {}, 2024: {}, 2025: {} },
};

export const W2: FormDefinition = {
  formFamily: "W2",
  baseYear: 2023,
  base: {
    fields: [
      // Aliases carry Azure DI prebuilt-tax field names (adapter contract, M3.3).
      money("w2.box1", "1", "Wages, tips, other compensation", {
        aliases: ["WagesTipsAndOtherCompensation"],
        hasCentsBox: false,
        taxonomyNodeKey: "pcf.income.wages",
      }),
      money("w2.box2", "2", "Federal income tax withheld", {
        aliases: ["FederalIncomeTaxWithheld"],
        hasCentsBox: false,
        taxonomyNodeKey: "pcf.outflow.federal_taxes",
      }),
      money("w2.box3", "3", "Social security wages", {
        aliases: ["SocialSecurityWages"],
        hasCentsBox: false,
      }),
      money("w2.box5", "5", "Medicare wages and tips", {
        aliases: ["MedicareWagesAndTips"],
        hasCentsBox: false,
      }),
      money("w2.box17", "17", "State income tax", {
        aliases: ["StateTaxesWithheld"],
        hasCentsBox: false,
        taxonomyNodeKey: "pcf.outflow.state_taxes",
      }),
    ],
    relations: [],
    flows: [],
  },
  overrides: { 2020: {}, 2021: {}, 2022: {}, 2024: {}, 2025: {} },
};
