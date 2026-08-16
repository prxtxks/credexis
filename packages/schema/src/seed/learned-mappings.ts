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
  { label: "Vehicles Repairs & Maint", node: "is.opex.vehicle" },
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
  { label: "Total for Utilities", node: "is.opex.utilities" },
  { label: "TRAINING & SEMINARS", node: "is.opex.training" },
  { label: "TRAVEL AGENT FEES", node: "is.opex.commissions_paid" },
  { label: "OTA Fees", node: "is.opex.commissions_paid" },
  { label: "Pest Control", node: "is.opex.misc" },
  { label: "Trash Removal", node: "is.opex.misc" },
  { label: "Employee Relations", node: "is.opex.misc" },
  { label: "Shipping & postage", node: "is.opex.postage_shipping" },
  { label: "Software & apps", node: "is.opex.software" },
  { label: "Total Expense", node: "is.opex.total" },
  { label: "Total Expenses", node: "is.opex.total" },
  { label: "Total for Expenses", node: "is.opex.total" },
  { label: "Total Operating Expenses", node: "is.opex.total" },

  // ── Annual P&L full vocabulary (verified against the printed pages,
  // 2026-07-22): unknown labels left to LLM variance kept polluting core
  // nodes ("Total Rooms"→revenue). Every entry below is page-verifiable.
  { label: "Lodging Sales", node: "is.revenue.rental_income" },
  { label: "Cash Revenue", node: "is.revenue.rental_income" },
  { label: "Credit Card Revenue", node: "is.revenue.rental_income" },
  { label: "Total Lodging Sales", node: "is.revenue.rental_income" },
  { label: "Commision Fees", node: "is.opex.commissions_paid" }, // sic — as printed
  { label: "Contract labor", node: "is.opex.contract_labor" },
  { label: "Management Fee", node: "is.opex.management_fees" },
  { label: "Meals and Entertainment", node: "is.opex.meals" },
  { label: "Janitorial Expense", node: "is.opex.janitorial" },
  { label: "Business Taxes", node: "is.opex.other_taxes" },
  { label: "In-Keepers Tax", node: "is.opex.other_taxes" },
  { label: "Sales Tax", node: "is.opex.other_taxes" },
  { label: "Total Tax Expense", node: "is.opex.other_taxes" },
  { label: "Royalties", node: "is.opex.royalties_franchise" },
  { label: "Total Rooms", node: "is.opex.misc" }, // rooms-dept costs section
  { label: "Small Tools and Equipment", node: "is.opex.small_equipment" }, // retargeted 2026-08-13: node added under ruling #3
  { label: "Breakfast Supplies", node: "is.opex.supplies" },
  { label: "Cleaning Supplies", node: "is.opex.supplies" },
  { label: "Laundry and Lodging Supplies", node: "is.opex.supplies" },
  { label: "Accounting & Consulting", node: "is.opex.professional_fees" },
  { label: "Payroll Taxes - FICA", node: "is.opex.payroll_taxes" },
  { label: "Payroll Taxes - Unemployment", node: "is.opex.payroll_taxes" },
  { label: "Payroll Taxes - Employer", node: "is.opex.payroll_taxes" },
  // Mixed employer-cost bucket (fees + taxes): payroll_taxes is the
  // closest node; where it collides with "Total Payroll Taxes" the
  // conflicting-totals rule refuses to guess and routes to review.
  { label: "Total 66000 Payroll Expenses", node: "is.opex.payroll_taxes" },
  { label: "Other Income - Credit Card Rewards", node: "is.other.other_income" },
  { label: "Total Other Expenses", node: "is.other.other_expense" },
  { label: "NET OTHER INCOME", node: "is.other.total" },

  // ── Annual P&L (QuickBooks numbered chart, verified vs GT 2026-07-22).
  // Stored as printed — normalizeLabel strips the account codes. ──────
  { label: "Total Cost of Goods Sold", node: "is.cogs.total" },
  { label: "Wages", node: "is.opex.salaries_wages" },
  { label: "Total Payroll Taxes", node: "is.opex.payroll_taxes" },
  { label: "Rent Expense", node: "is.opex.rent" },
  { label: "Total 68600 Utilities", node: "is.opex.utilities" },
  { label: "Total 63300 Insurance Expense", node: "is.opex.insurance" },
  { label: "Total 67200 Repairs and Maintenance", node: "is.opex.repairs_maintenance" },
  { label: "Total Operating Supplies", node: "is.opex.supplies" },
  { label: "Total 66700 Professional Fees", node: "is.opex.professional_fees" },
  { label: "60000 Advertising and Promotion", node: "is.opex.marketing_advertising" },

  // ── Below the operating line ────────────────────────────────────────
  { label: "Interest", node: "is.other.interest_expense" },
  { label: "Interest paid", node: "is.other.interest_expense" },
  { label: "INTEREST EXPENSE", node: "is.other.interest_expense" },
  { label: "INTEREST REVENUE", node: "is.other.interest_income" },
  { label: "Other Income", node: "is.other.other_income" },
  { label: "Total Other Income", node: "is.other.other_income" },
  { label: "SALES TAX DISCOUNTS", node: "is.other.other_income" },
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
  // CPA compiled statements (Maitripriya, page-verified 2026-07-22):
  // fixed assets close with "Net Property and Equipment"; "Non Current
  // Assets" is the intangibles section (goodwill − amortization). The
  // earlier fixed.total mapping for it was a vocabulary error — it made
  // the conflicting-totals rule kill fixed.total on the doc that DEFINED
  // these labels. Where another chart uses "Total Non Current Assets"
  // as fixed+other combined, the conflict/direction rules route it to
  // review rather than silently polluting either node.
  { label: "Net Property and Equipment", node: "bs.assets.fixed.total" },
  { label: "Total Non Current Assets", node: "bs.assets.other.total" },
  { label: "Accumulated Depreciation", node: "bs.assets.fixed.accumulated_depreciation" },
  { label: "Goodwill", node: "bs.assets.other.goodwill" },
  { label: "Total Other Assets", node: "bs.assets.other.total" },
  { label: "Total Assets", node: "bs.assets.total" },
  { label: "Sales Tax Payable", node: "bs.liabilities.current.accrued" },
  { label: "Total Current Liabilities", node: "bs.liabilities.current.total" },
  { label: "Total Long Term Liabilities", node: "bs.liabilities.longterm.total" },
  { label: "Total Long-Term Liabilities", node: "bs.liabilities.longterm.total" },
  { label: "Total Liabilities", node: "bs.liabilities.total" },
  { label: "Total Equity", node: "bs.equity.total" },
  { label: "Total Partners' Equity", node: "bs.equity.total" },
  { label: "TOTAL LIABILITIES & EQUITY", node: "bs.total_liabilities_equity" },
  { label: "Total Liabilities and Partners' Equity", node: "bs.total_liabilities_equity" },

  // ── V1 (UnderlyticsAI) banker synonym map — domain-expert vocabulary,
  // translated to TAXONOMY_V1 nodes (m1-3, 2026-07-22). Raw labels;
  // normalizeLabel dedups against the entries above. ──────────────────
  { label: "sales", node: "is.revenue.total" },
  { label: "gross sales", node: "is.revenue.total" },
  { label: "gross receipts", node: "is.revenue.total" },
  { label: "total revenue", node: "is.revenue.total" },
  { label: "cost of sales", node: "is.cogs.total" },
  { label: "cost of revenue", node: "is.cogs.total" },
  { label: "direct costs", node: "is.cogs.total" },
  { label: "net earnings", node: "is.net_income" },
  { label: "net profit", node: "is.net_income" },
  { label: "net loss", node: "is.net_income" },
  { label: "net profit (loss)", node: "is.net_income" },
  { label: "bottom line", node: "is.net_income" },
  { label: "gross margin", node: "is.gross_profit" },
  { label: "overhead", node: "is.opex.total" },
  { label: "sg&a", node: "is.opex.total" },
  { label: "selling general and administrative", node: "is.opex.total" },
  { label: "general and administrative", node: "is.opex.total" },
  { label: "operating costs", node: "is.opex.total" },
  { label: "payroll", node: "is.opex.salaries_wages" },
  { label: "salaries and wages", node: "is.opex.salaries_wages" },
  { label: "wages and salaries", node: "is.opex.salaries_wages" },
  { label: "payroll expense", node: "is.opex.salaries_wages" },
  { label: "lease expense", node: "is.opex.rent" },
  { label: "depr.", node: "is.opex.depreciation" },
  { label: "depreciation expense", node: "is.opex.depreciation" },
  { label: "amort.", node: "is.opex.amortization" },
  { label: "interest on loans", node: "is.other.interest_expense" },
  { label: "loan interest", node: "is.other.interest_expense" },
  { label: "mortgage interest", node: "is.other.interest_expense" },
  { label: "bank fees", node: "is.opex.bank_charges" },
  { label: "merchant fees", node: "is.opex.merchant_fees" },
  { label: "processing fees", node: "is.opex.merchant_fees" },
  { label: "accounting", node: "is.opex.accounting_fees" },
  { label: "legal fees", node: "is.opex.legal_fees" },
  { label: "professional services", node: "is.opex.professional_fees" },
  { label: "r&m", node: "is.opex.repairs_maintenance" },
  { label: "ads", node: "is.opex.marketing_advertising" },
  { label: "marketing", node: "is.opex.marketing_advertising" },
  // ── M23 recall push (2026-08-13): every row below is a label PRINTED on a
  // human-verified corpus document (docs/testing-docs/labeling-batch-2/3),
  // bound where the ground truth binds it. ADR-0004: vocabulary from evidence.
  { label: "Travel Expense", node: "is.opex.travel" },
  { label: "Travel Expenses", node: "is.opex.travel" },
  { label: "Travel", node: "is.opex.travel" },
  { label: "Meals & Entertainment", node: "is.opex.meals" },
  { label: "Meals & Entertaintment", node: "is.opex.meals" }, // typo as printed (Niyazi)
  { label: "Uniforms", node: "is.opex.uniforms" },
  { label: "Wages - Officer", node: "is.opex.officer_comp" },
  { label: "Officer Wages", node: "is.opex.officer_comp" },
  { label: "Officer Compensation", node: "is.opex.officer_comp" },
  { label: "Officer Salary", node: "is.opex.officer_comp" },
  { label: "Personal Property Taxes", node: "is.opex.property_taxes" },
  { label: "Real Estate Taxes", node: "is.opex.property_taxes" },
  { label: "Property Taxes", node: "is.opex.property_taxes" },
  { label: "Property Tax", node: "is.opex.property_taxes" },
  { label: "Sales Tax Expense", node: "is.opex.other_taxes" },
  { label: "Taxes Expense", node: "is.opex.other_taxes" },
  { label: "Bad Debt Expense", node: "is.opex.bad_debt" },
  { label: "Bad Debt", node: "is.opex.bad_debt" },
  { label: "Outside Services", node: "is.opex.contract_labor" },
  { label: "Computer and Internet Expenses", node: "is.opex.telephone_internet" },
  { label: "Point of Sale System Fee", node: "is.opex.software" },
  { label: "Software Fees", node: "is.opex.software" },
  { label: "Accounting Fees", node: "is.opex.accounting_fees" },
  { label: "Merchandise Sales", node: "is.revenue.product_sales" },
  { label: "Purchases", node: "is.cogs.purchases" },
  { label: "Snow Removal Expense", node: "is.opex.repairs_maintenance" }, // ruling #1 sum
  { label: "Cash Short (Over)", node: "is.opex.misc" },
  { label: "TOTAL OTHER INCOME (EXPENSES)", node: "is.other.total" },
  { label: "NET INCOME (LOSS) BEFORE TAXES", node: "is.pretax_income" },
  { label: "Credit Cards Processing Fees", node: "is.opex.merchant_fees" },
];
