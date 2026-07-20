/**
 * Global learned-mappings seed (M5.4 cost decay, jump-started): every
 * label ↔ taxonomy pair VERIFIED against real corpus documents
 * (2026-07-20 batch: two hotels, a gas station, a QuickBooks annual P&L,
 * a CPA balance sheet). Seeding the global pool means these labels map
 * with ZERO LLM calls from the first document — localhost runs the
 * statement chain free, and production only pays for genuinely new
 * vocabulary.
 *
 * Rules:
 * - Only pairs a human (or arithmetic identity) confirmed — never guesses.
 * - Seeded as source "human" so an LLM write-back can never downgrade them.
 * - Labels are stored RAW here; the seeder normalizes exactly like the
 *   mapper (lowercase, strip non-alphanumerics, collapse whitespace).
 */

export interface LearnedMappingSeed {
  label: string;
  node: string;
}

export const LEARNED_MAPPINGS_SEED: LearnedMappingSeed[] = [
  // ── Revenue (hotels, gas stations, generic) ─────────────────────────
  { label: "Room Revenue", node: "is.revenue.rental_income" },
  { label: "ROOM RENTAL", node: "is.revenue.rental_income" },
  { label: "MISC. INCOME", node: "is.revenue.other" },
  { label: "Income", node: "is.revenue.total" },
  { label: "Total for Income", node: "is.revenue.total" },
  { label: "Total Sales", node: "is.revenue.total" },
  { label: "Total Income", node: "is.revenue.total" },
  { label: "Cost of Goods Sold", node: "is.cogs.total" },
  { label: "Gross Profit", node: "is.gross_profit" },

  // ── Operating expenses (verified across four real statements) ───────
  { label: "ADVERTISING", node: "is.opex.marketing_advertising" },
  { label: "Amortization", node: "is.opex.amortization" },
  { label: "AMORTIZATION EXPENSE", node: "is.opex.amortization" },
  { label: "Depreciation", node: "is.opex.depreciation" },
  { label: "Automobile Expense", node: "is.opex.vehicle" },
  { label: "Vehicle gas & fuel", node: "is.opex.fuel" },
  { label: "Bank Service Charges", node: "is.opex.bank_charges" },
  { label: "BANK CHARGES", node: "is.opex.bank_charges" },
  { label: "Bank fees & service charges", node: "is.opex.bank_charges" },
  { label: "CREDIT CARD FEES", node: "is.opex.merchant_fees" },
  { label: "Merchant account fees", node: "is.opex.merchant_fees" },
  { label: "DUES & SUBSCRIPTIONS", node: "is.opex.dues_subscriptions" },
  { label: "Franchise Fee", node: "is.opex.royalties_franchise" },
  { label: "Franchise Fees", node: "is.opex.royalties_franchise" },
  { label: "FRANCHISE FEE EXPENSE", node: "is.opex.royalties_franchise" },
  { label: "Insurance Expense", node: "is.opex.insurance" },
  { label: "Business insurance", node: "is.opex.insurance" },
  { label: "INSURANCE", node: "is.opex.insurance" },
  { label: "Total for Insurance", node: "is.opex.insurance" },
  { label: "LEGAL & ACCOUNTING", node: "is.opex.professional_fees" },
  { label: "Professional Fees", node: "is.opex.professional_fees" },
  { label: "Business licenses", node: "is.opex.licenses_permits" },
  { label: "LICENSES, PERMITS & FEES", node: "is.opex.licenses_permits" },
  { label: "MAINTENANCE & REPAIRS", node: "is.opex.repairs_maintenance" },
  { label: "Repairs and Maintenance", node: "is.opex.repairs_maintenance" },
  { label: "Repairs & maintenance", node: "is.opex.repairs_maintenance" },
  { label: "OFFICE EXPENSE", node: "is.opex.office_expense" },
  { label: "Office Supplies", node: "is.opex.office_expense" },
  { label: "Salary", node: "is.opex.salaries_wages" },
  { label: "SALARIES", node: "is.opex.salaries_wages" },
  { label: "Payroll expenses", node: "is.opex.salaries_wages" },
  { label: "Payroll Taxes", node: "is.opex.payroll_taxes" },
  { label: "TAXES - PAYROLL", node: "is.opex.payroll_taxes" },
  { label: "TAXES - GENERAL", node: "is.opex.other_taxes" },
  { label: "SECURITY", node: "is.opex.security" },
  { label: "OPERATING SUPPLIES", node: "is.opex.supplies" },
  { label: "Supplies & materials", node: "is.opex.supplies" },
  { label: "Total for Supplies", node: "is.opex.supplies" },
  { label: "Telephone Expense", node: "is.opex.telephone_internet" },
  { label: "TELEPHONE-CELL PHONE", node: "is.opex.telephone_internet" },
  { label: "Phone service", node: "is.opex.telephone_internet" },
  { label: "Internet & TV services", node: "is.opex.telephone_internet" },
  { label: "Heating & cooling", node: "is.opex.utilities" },
  { label: "Utilities", node: "is.opex.utilities" },
  { label: "UTILITIES", node: "is.opex.utilities" },
  { label: "Total for Utilities", node: "is.opex.utilities" },
  { label: "TRAINING & SEMINARS", node: "is.opex.training" },
  { label: "TRAVEL AGENT FEES", node: "is.opex.commissions_paid" },
  { label: "OTA Fees", node: "is.opex.commissions_paid" },
  { label: "Pest Control", node: "is.opex.misc" },
  { label: "Trash Removal", node: "is.opex.misc" },
  { label: "Shipping & postage", node: "is.opex.postage_shipping" },
  { label: "Software & apps", node: "is.opex.software" },
  { label: "Total Expense", node: "is.opex.total" },
  { label: "Total Expenses", node: "is.opex.total" },
  { label: "Total for Expenses", node: "is.opex.total" },
  { label: "Total Operating Expenses", node: "is.opex.total" },

  // ── Below the operating line ────────────────────────────────────────
  { label: "Interest", node: "is.other.interest_expense" },
  { label: "Interest paid", node: "is.other.interest_expense" },
  { label: "INTEREST EXPENSE", node: "is.other.interest_expense" },
  { label: "INTEREST REVENUE", node: "is.other.interest_income" },
  { label: "Other Income", node: "is.other.other_income" },
  { label: "Total Other Income", node: "is.other.other_income" },
  { label: "Net Ordinary Income", node: "is.operating_income" },
  { label: "Net Operating Income", node: "is.operating_income" },
  { label: "Operating Income (Loss)", node: "is.operating_income" },
  { label: "Net Income", node: "is.net_income" },
  { label: "Net Income (Loss)", node: "is.net_income" },

  // ── Balance sheet (CPA statement, verified 9/9) ─────────────────────
  { label: "Petty Cash", node: "bs.assets.current.cash" },
  { label: "Cash on Hand", node: "bs.assets.current.cash" },
  { label: "Checking: General", node: "bs.assets.current.checking" },
  { label: "Checking/Savings", node: "bs.assets.current.cash" },
  { label: "Accounts Receivable", node: "bs.assets.current.accounts_receivable" },
  { label: "Inventories", node: "bs.assets.current.inventory" },
  { label: "Total Current Assets", node: "bs.assets.current.total" },
  { label: "Total Fixed Assets", node: "bs.assets.fixed.total" },
  { label: "Total Non Current Assets", node: "bs.assets.fixed.total" },
  { label: "Accumulated Depreciation", node: "bs.assets.fixed.accumulated_depreciation" },
  { label: "Goodwill", node: "bs.assets.other.goodwill" },
  { label: "Total Other Assets", node: "bs.assets.other.total" },
  { label: "Total Assets", node: "bs.assets.total" },
  { label: "TOTAL ASSETS", node: "bs.assets.total" },
  { label: "Sales Tax Payable", node: "bs.liabilities.current.accrued" },
  { label: "Total Current Liabilities", node: "bs.liabilities.current.total" },
  { label: "Total Long Term Liabilities", node: "bs.liabilities.longterm.total" },
  { label: "Total Long-Term Liabilities", node: "bs.liabilities.longterm.total" },
  { label: "Total Liabilities", node: "bs.liabilities.total" },
  { label: "Total Equity", node: "bs.equity.total" },
  { label: "Total Partners' Equity", node: "bs.equity.total" },
  { label: "TOTAL LIABILITIES & EQUITY", node: "bs.total_liabilities_equity" },
  { label: "Total Liabilities and Partners' Equity", node: "bs.total_liabilities_equity" },
];
