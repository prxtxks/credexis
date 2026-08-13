/**
 * Canonical taxonomy v1 (M2.6) — the ~200-node SBA-oriented chart of
 * accounts every extracted line item maps into (Blueprint §4.3).
 *
 * Design rules:
 * - Keys are stable dotted paths; the key IS the identity. Never rename a
 *   key — add a node and migrate mappings.
 * - Officer comp, rent, depreciation, amortization, interest are FIRST-CLASS
 *   nodes (`isAddbackRelevant`) because the addback engine (M7.3) keys on
 *   them.
 * - Subtotal/summary rows that appear on real statements (Gross Profit,
 *   Total Assets, …) are nodes too — statements print them and the mapper
 *   must have a target; structure validation (M5.5) checks them numerically.
 *
 * [PRATIK] review pending: node granularity vs real underwriting needs
 * (task M2.6 flags seed values for human review).
 */

import type { statementKind } from "../db/enums.js";

type Statement = (typeof statementKind.enumValues)[number];

export interface TaxonomyNodeSeed {
  key: string;
  parentKey: string | null;
  label: string;
  statement: Statement;
  isAddbackRelevant: boolean;
  sortOrder: number;
  version: number;
}

/** [key, parentKey, label, addbackRelevant?] — statement + order derived. */
type Row = [key: string, parent: string | null, label: string, addback?: true];

const IS: Row[] = [
  // ── Revenue ────────────────────────────────────────────────────────────
  ["is", null, "Income Statement"],
  ["is.revenue", "is", "Revenue"],
  ["is.revenue.product_sales", "is.revenue", "Product sales"],
  ["is.revenue.service_revenue", "is.revenue", "Service revenue"],
  ["is.revenue.contract_revenue", "is.revenue", "Contract revenue"],
  ["is.revenue.rental_income", "is.revenue", "Rental income (operating)"],
  ["is.revenue.commissions", "is.revenue", "Commission income"],
  ["is.revenue.grants", "is.revenue", "Grant income"],
  ["is.revenue.returns_allowances", "is.revenue", "Returns and allowances"],
  ["is.revenue.discounts", "is.revenue", "Sales discounts"],
  ["is.revenue.other", "is.revenue", "Other operating revenue"],
  ["is.revenue.total", "is.revenue", "Total revenue"],
  // ── COGS ───────────────────────────────────────────────────────────────
  ["is.cogs", "is", "Cost of goods sold"],
  ["is.cogs.beginning_inventory", "is.cogs", "Beginning inventory"],
  ["is.cogs.purchases", "is.cogs", "Purchases"],
  ["is.cogs.materials", "is.cogs", "Materials and supplies"],
  ["is.cogs.direct_labor", "is.cogs", "Direct labor"],
  ["is.cogs.subcontractors", "is.cogs", "Subcontractors"],
  ["is.cogs.freight_in", "is.cogs", "Freight and shipping (in)"],
  ["is.cogs.equipment_rental", "is.cogs", "Equipment rental (jobs)"],
  ["is.cogs.ending_inventory", "is.cogs", "Ending inventory"],
  ["is.cogs.other", "is.cogs", "Other cost of sales"],
  ["is.cogs.total", "is.cogs", "Total cost of goods sold"],
  ["is.gross_profit", "is", "Gross profit"],
  // ── Operating expenses ────────────────────────────────────────────────
  ["is.opex", "is", "Operating expenses"],
  ["is.opex.officer_comp", "is.opex", "Officer compensation", true],
  ["is.opex.salaries_wages", "is.opex", "Salaries and wages"],
  ["is.opex.payroll_taxes", "is.opex", "Payroll taxes"],
  ["is.opex.employee_benefits", "is.opex", "Employee benefits"],
  ["is.opex.retirement_plans", "is.opex", "Retirement plan contributions"],
  ["is.opex.contract_labor", "is.opex", "Contract labor"],
  ["is.opex.rent", "is.opex", "Rent and lease expense", true],
  ["is.opex.equipment_lease", "is.opex", "Equipment leases"],
  ["is.opex.utilities", "is.opex", "Utilities"],
  ["is.opex.telephone_internet", "is.opex", "Telephone and internet"],
  ["is.opex.insurance", "is.opex", "Insurance (general)"],
  ["is.opex.health_insurance", "is.opex", "Health insurance"],
  ["is.opex.workers_comp", "is.opex", "Workers compensation"],
  ["is.opex.repairs_maintenance", "is.opex", "Repairs and maintenance"],
  ["is.opex.janitorial", "is.opex", "Cleaning and janitorial"],
  ["is.opex.supplies", "is.opex", "Supplies"],
  // Added by domain ruling 2026-08-12 (docs/DOMAIN-RULINGS.md #3): printed on
  // multiple real hotel P&Ls; distinct from consumable supplies.
  ["is.opex.small_equipment", "is.opex", "Small tools and equipment"],
  ["is.opex.office_expense", "is.opex", "Office expense"],
  ["is.opex.postage_shipping", "is.opex", "Postage and shipping (out)"],
  ["is.opex.printing", "is.opex", "Printing and reproduction"],
  ["is.opex.marketing_advertising", "is.opex", "Marketing and advertising"],
  ["is.opex.travel", "is.opex", "Travel"],
  ["is.opex.meals", "is.opex", "Meals and entertainment"],
  ["is.opex.vehicle", "is.opex", "Vehicle expense"],
  ["is.opex.fuel", "is.opex", "Fuel"],
  ["is.opex.professional_fees", "is.opex", "Professional fees"],
  ["is.opex.legal_fees", "is.opex", "Legal fees"],
  ["is.opex.accounting_fees", "is.opex", "Accounting fees"],
  ["is.opex.consulting_fees", "is.opex", "Consulting fees"],
  ["is.opex.management_fees", "is.opex", "Management fees", true],
  ["is.opex.bank_charges", "is.opex", "Bank charges"],
  ["is.opex.merchant_fees", "is.opex", "Merchant and card fees"],
  ["is.opex.dues_subscriptions", "is.opex", "Dues and subscriptions"],
  ["is.opex.software", "is.opex", "Software and technology"],
  ["is.opex.licenses_permits", "is.opex", "Licenses and permits"],
  ["is.opex.property_taxes", "is.opex", "Property taxes"],
  ["is.opex.other_taxes", "is.opex", "Taxes and licenses (other)"],
  ["is.opex.bad_debt", "is.opex", "Bad debt expense"],
  ["is.opex.charitable", "is.opex", "Charitable contributions"],
  ["is.opex.training", "is.opex", "Training and education"],
  ["is.opex.uniforms", "is.opex", "Uniforms and laundry"],
  ["is.opex.security", "is.opex", "Security"],
  ["is.opex.storage", "is.opex", "Storage"],
  ["is.opex.commissions_paid", "is.opex", "Commissions paid"],
  ["is.opex.royalties_franchise", "is.opex", "Royalty and franchise fees"],
  ["is.opex.depreciation", "is.opex", "Depreciation", true],
  ["is.opex.amortization", "is.opex", "Amortization", true],
  ["is.opex.misc", "is.opex", "Miscellaneous expense"],
  ["is.opex.total", "is.opex", "Total operating expenses"],
  ["is.operating_income", "is", "Operating income"],
  // ── Other income / expense ────────────────────────────────────────────
  ["is.other", "is", "Other income and expense"],
  ["is.other.interest_income", "is.other", "Interest income"],
  ["is.other.dividend_income", "is.other", "Dividend income"],
  ["is.other.interest_expense", "is.other", "Interest expense", true],
  ["is.other.gain_loss_asset_sales", "is.other", "Gain/loss on asset sales", true],
  ["is.other.rental_income_nonop", "is.other", "Rental income (non-operating)"],
  ["is.other.one_time_items", "is.other", "One-time / non-recurring items", true],
  ["is.other.insurance_proceeds", "is.other", "Insurance proceeds", true],
  ["is.other.ppp_erc_grants", "is.other", "PPP/ERC and relief grants", true],
  ["is.other.other_income", "is.other", "Other income"],
  ["is.other.other_expense", "is.other", "Other expense"],
  ["is.other.total", "is.other", "Total other income (expense)"],
  // ── Bottom ────────────────────────────────────────────────────────────
  ["is.pretax_income", "is", "Income before taxes"],
  ["is.income_tax", "is", "Income tax expense"],
  ["is.net_income", "is", "Net income"],
];

const BS: Row[] = [
  ["bs", null, "Balance Sheet"],
  // ── Current assets ────────────────────────────────────────────────────
  ["bs.assets", "bs", "Assets"],
  ["bs.assets.current", "bs.assets", "Current assets"],
  ["bs.assets.current.cash", "bs.assets.current", "Cash and equivalents"],
  ["bs.assets.current.checking", "bs.assets.current", "Checking accounts"],
  ["bs.assets.current.savings", "bs.assets.current", "Savings and money market"],
  ["bs.assets.current.accounts_receivable", "bs.assets.current", "Accounts receivable"],
  ["bs.assets.current.allowance_doubtful", "bs.assets.current", "Allowance for doubtful accounts"],
  ["bs.assets.current.inventory", "bs.assets.current", "Inventory"],
  ["bs.assets.current.prepaid", "bs.assets.current", "Prepaid expenses"],
  ["bs.assets.current.notes_receivable", "bs.assets.current", "Notes receivable (current)"],
  ["bs.assets.current.employee_advances", "bs.assets.current", "Employee advances"],
  ["bs.assets.current.other", "bs.assets.current", "Other current assets"],
  ["bs.assets.current.total", "bs.assets.current", "Total current assets"],
  // ── Non-current assets ────────────────────────────────────────────────
  ["bs.assets.fixed", "bs.assets", "Fixed assets"],
  ["bs.assets.fixed.land", "bs.assets.fixed", "Land"],
  ["bs.assets.fixed.buildings", "bs.assets.fixed", "Buildings"],
  ["bs.assets.fixed.leasehold_improvements", "bs.assets.fixed", "Leasehold improvements"],
  ["bs.assets.fixed.machinery_equipment", "bs.assets.fixed", "Machinery and equipment"],
  ["bs.assets.fixed.vehicles", "bs.assets.fixed", "Vehicles"],
  ["bs.assets.fixed.furniture_fixtures", "bs.assets.fixed", "Furniture and fixtures"],
  ["bs.assets.fixed.computers", "bs.assets.fixed", "Computer equipment"],
  ["bs.assets.fixed.construction_in_progress", "bs.assets.fixed", "Construction in progress"],
  ["bs.assets.fixed.accumulated_depreciation", "bs.assets.fixed", "Accumulated depreciation"],
  ["bs.assets.fixed.total", "bs.assets.fixed", "Total fixed assets (net)"],
  ["bs.assets.other", "bs.assets", "Other assets"],
  ["bs.assets.other.intangibles", "bs.assets.other", "Intangible assets"],
  ["bs.assets.other.goodwill", "bs.assets.other", "Goodwill"],
  ["bs.assets.other.accumulated_amortization", "bs.assets.other", "Accumulated amortization"],
  ["bs.assets.other.notes_receivable_lt", "bs.assets.other", "Notes receivable (long-term)"],
  ["bs.assets.other.due_from_related", "bs.assets.other", "Due from related parties"],
  ["bs.assets.other.due_from_shareholders", "bs.assets.other", "Due from shareholders"],
  ["bs.assets.other.investments", "bs.assets.other", "Investments"],
  ["bs.assets.other.deposits", "bs.assets.other", "Security deposits"],
  ["bs.assets.other.other", "bs.assets.other", "Other non-current assets"],
  ["bs.assets.other.total", "bs.assets.other", "Total other assets"],
  ["bs.assets.total", "bs.assets", "Total assets"],
  // ── Current liabilities ───────────────────────────────────────────────
  ["bs.liabilities", "bs", "Liabilities"],
  ["bs.liabilities.current", "bs.liabilities", "Current liabilities"],
  ["bs.liabilities.current.accounts_payable", "bs.liabilities.current", "Accounts payable"],
  ["bs.liabilities.current.credit_cards", "bs.liabilities.current", "Credit cards payable"],
  ["bs.liabilities.current.accrued", "bs.liabilities.current", "Accrued expenses"],
  ["bs.liabilities.current.payroll", "bs.liabilities.current", "Payroll liabilities"],
  ["bs.liabilities.current.sales_tax", "bs.liabilities.current", "Sales tax payable"],
  ["bs.liabilities.current.income_tax", "bs.liabilities.current", "Income taxes payable"],
  ["bs.liabilities.current.line_of_credit", "bs.liabilities.current", "Line of credit"],
  [
    "bs.liabilities.current.current_portion_ltd",
    "bs.liabilities.current",
    "Current portion of long-term debt",
  ],
  ["bs.liabilities.current.customer_deposits", "bs.liabilities.current", "Customer deposits"],
  ["bs.liabilities.current.deferred_revenue", "bs.liabilities.current", "Deferred revenue"],
  ["bs.liabilities.current.other", "bs.liabilities.current", "Other current liabilities"],
  ["bs.liabilities.current.total", "bs.liabilities.current", "Total current liabilities"],
  // ── Long-term liabilities ─────────────────────────────────────────────
  ["bs.liabilities.longterm", "bs.liabilities", "Long-term liabilities"],
  ["bs.liabilities.longterm.notes_payable", "bs.liabilities.longterm", "Notes payable"],
  ["bs.liabilities.longterm.mortgages", "bs.liabilities.longterm", "Mortgages payable"],
  ["bs.liabilities.longterm.equipment_loans", "bs.liabilities.longterm", "Equipment loans"],
  ["bs.liabilities.longterm.vehicle_loans", "bs.liabilities.longterm", "Vehicle loans"],
  ["bs.liabilities.longterm.sba_loans", "bs.liabilities.longterm", "SBA loans"],
  [
    "bs.liabilities.longterm.stockholder_loans",
    "bs.liabilities.longterm",
    "Loans from stockholders",
  ],
  ["bs.liabilities.longterm.due_to_related", "bs.liabilities.longterm", "Due to related parties"],
  ["bs.liabilities.longterm.deferred_taxes", "bs.liabilities.longterm", "Deferred income taxes"],
  ["bs.liabilities.longterm.other", "bs.liabilities.longterm", "Other long-term liabilities"],
  ["bs.liabilities.longterm.total", "bs.liabilities.longterm", "Total long-term liabilities"],
  ["bs.liabilities.total", "bs.liabilities", "Total liabilities"],
  // ── Equity ────────────────────────────────────────────────────────────
  ["bs.equity", "bs", "Equity"],
  ["bs.equity.common_stock", "bs.equity", "Common stock"],
  ["bs.equity.preferred_stock", "bs.equity", "Preferred stock"],
  ["bs.equity.paid_in_capital", "bs.equity", "Additional paid-in capital"],
  ["bs.equity.partner_capital", "bs.equity", "Partner/member capital"],
  ["bs.equity.retained_earnings", "bs.equity", "Retained earnings"],
  ["bs.equity.current_year_earnings", "bs.equity", "Current year earnings"],
  ["bs.equity.distributions", "bs.equity", "Distributions"],
  ["bs.equity.owner_draws", "bs.equity", "Owner draws"],
  ["bs.equity.owner_contributions", "bs.equity", "Owner contributions"],
  ["bs.equity.treasury_stock", "bs.equity", "Treasury stock"],
  ["bs.equity.other", "bs.equity", "Other equity"],
  ["bs.equity.total", "bs.equity", "Total equity"],
  ["bs.total_liabilities_equity", "bs", "Total liabilities and equity"],
];

const PERSONAL: Row[] = [
  // Guarantor personal cash flow (global DSCR, Blueprint §7 / M7.4).
  ["pcf", null, "Personal Cash Flow"],
  ["pcf.income", "pcf", "Personal income"],
  ["pcf.income.wages", "pcf.income", "Wages and salaries (W-2)"],
  ["pcf.income.interest_dividends", "pcf.income", "Interest and dividend income"],
  ["pcf.income.business", "pcf.income", "Business income (Schedule C)"],
  ["pcf.income.k1", "pcf.income", "K-1 pass-through income"],
  ["pcf.income.k1_distributions", "pcf.income", "K-1 cash distributions"],
  ["pcf.income.rental", "pcf.income", "Rental income (Schedule E)"],
  ["pcf.income.capital_gains", "pcf.income", "Capital gains"],
  ["pcf.income.retirement", "pcf.income", "Retirement and pension income"],
  ["pcf.income.social_security", "pcf.income", "Social Security income"],
  ["pcf.income.spouse_wages", "pcf.income", "Spouse wages"],
  ["pcf.income.other", "pcf.income", "Other personal income"],
  ["pcf.income.total", "pcf.income", "Total personal income"],
  ["pcf.outflow", "pcf", "Personal outflows"],
  ["pcf.outflow.federal_taxes", "pcf.outflow", "Federal income taxes"],
  ["pcf.outflow.state_taxes", "pcf.outflow", "State and local taxes"],
  ["pcf.outflow.living_expenses", "pcf.outflow", "Living expenses"],
  ["pcf.outflow.mortgage", "pcf.outflow", "Personal mortgage payments"],
  ["pcf.outflow.rent", "pcf.outflow", "Personal rent"],
  ["pcf.outflow.auto_loans", "pcf.outflow", "Auto loan payments"],
  ["pcf.outflow.student_loans", "pcf.outflow", "Student loan payments"],
  ["pcf.outflow.credit_cards", "pcf.outflow", "Credit card payments"],
  ["pcf.outflow.other_debt", "pcf.outflow", "Other personal debt service"],
  ["pcf.outflow.alimony_support", "pcf.outflow", "Alimony and child support"],
  ["pcf.outflow.insurance", "pcf.outflow", "Personal insurance"],
  ["pcf.outflow.other", "pcf.outflow", "Other personal outflows"],
  ["pcf.outflow.total", "pcf.outflow", "Total personal outflows"],
];

const DEBT: Row[] = [
  // Business debt schedule line targets (pro-forma debt schedule).
  ["debt", null, "Debt Schedule"],
  ["debt.term_loan", "debt", "Term loan"],
  ["debt.sba_loan", "debt", "Existing SBA loan"],
  ["debt.mortgage", "debt", "Commercial mortgage"],
  ["debt.equipment_loan", "debt", "Equipment loan"],
  ["debt.vehicle_loan", "debt", "Vehicle loan"],
  ["debt.line_of_credit", "debt", "Line of credit"],
  ["debt.credit_card", "debt", "Business credit card"],
  ["debt.merchant_advance", "debt", "Merchant cash advance"],
  ["debt.stockholder_loan", "debt", "Stockholder/related-party loan"],
  ["debt.seller_note", "debt", "Seller note"],
  ["debt.other", "debt", "Other business debt"],
  ["debt.total_payments", "debt", "Total annual debt service"],
];

function toSeeds(rows: Row[], statement: Statement, base: number): TaxonomyNodeSeed[] {
  return rows.map(([key, parentKey, label, addback], i) => ({
    key,
    parentKey,
    label,
    statement,
    isAddbackRelevant: addback === true,
    // Per-group base keeps sortOrder unique among root-level siblings too.
    sortOrder: base + (i + 1) * 10,
    version: 1,
  }));
}

export const TAXONOMY_V1: TaxonomyNodeSeed[] = [
  ...toSeeds(IS, "income_statement", 0),
  ...toSeeds(BS, "balance_sheet", 10_000),
  ...toSeeds(PERSONAL, "cash_flow", 20_000),
  ...toSeeds(DEBT, "other", 30_000),
];

/** Addback categories (M7.3) resolve to these keys — kept explicit. */
export const FIRST_CLASS_ADDBACK_KEYS = [
  "is.opex.officer_comp",
  "is.opex.rent",
  "is.opex.depreciation",
  "is.opex.amortization",
  "is.other.interest_expense",
] as const;
