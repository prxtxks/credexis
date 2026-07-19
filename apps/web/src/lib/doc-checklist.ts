/**
 * Doc-completeness checklists per deal type (M8.7, Blueprint §8.2) —
 * which form families an SBA 7(a) file needs before underwriting can
 * finish. Display data for the pipeline board; SOP thresholds stay in the
 * policy pack (Iron Law #8) — this is a workflow aid, not compliance.
 */

export interface ChecklistItem {
  /** Form families that satisfy this item (any match counts). */
  formFamilies: string[];
  label: string;
}

const BUSINESS_RETURNS: ChecklistItem = {
  formFamilies: ["1120", "1120S", "1065"],
  label: "Business tax returns (3y)",
};
const PERSONAL_RETURNS: ChecklistItem = {
  formFamilies: ["1040"],
  label: "Personal tax returns (guarantors)",
};
const INTERIM_PNL: ChecklistItem = { formFamilies: ["PNL"], label: "Interim P&L" };
const BALANCE_SHEET: ChecklistItem = { formFamilies: ["BALANCE_SHEET"], label: "Balance sheet" };
const DEBT_SCHEDULE: ChecklistItem = { formFamilies: ["DEBT_SCHEDULE"], label: "Debt schedule" };

export const DOC_CHECKLIST: Record<string, ChecklistItem[]> = {
  business_acquisition: [
    BUSINESS_RETURNS,
    PERSONAL_RETURNS,
    INTERIM_PNL,
    BALANCE_SHEET,
    DEBT_SCHEDULE,
  ],
  working_capital: [BUSINESS_RETURNS, PERSONAL_RETURNS, INTERIM_PNL, BALANCE_SHEET],
  real_estate: [BUSINESS_RETURNS, PERSONAL_RETURNS, BALANCE_SHEET, DEBT_SCHEDULE],
  refinance: [BUSINESS_RETURNS, PERSONAL_RETURNS, BALANCE_SHEET, DEBT_SCHEDULE],
};

export function checklistFor(dealType: string): ChecklistItem[] {
  return DOC_CHECKLIST[dealType] ?? [BUSINESS_RETURNS, PERSONAL_RETURNS];
}
