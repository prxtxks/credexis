# Golden deals — the engine's constitution (M7.6)

Each folder here is one **complete real deal** with an expert-built Excel
pro-forma. The harness (`src/golden.test.ts`) replays every deal through
`computeMetrics` and requires **cent-exact** agreement with the workbook's
bottom lines — on every CI run, forever. The engine is certified only when
**≥ 3 real deals** live here and pass.

## Folder format

```
golden-deals/
  <deal-slug>/            # kebab-case, e.g. hvac-acquisition-tx
    proforma.xlsx         # the expert's ORIGINAL workbook — source of truth, kept for audit
    deal.json             # canonical machine form (below) — derived from the workbook
    documents/            # optional: the deal's source PDFs (for future end-to-end runs)
```

`_synthetic-*` folders are harness self-checks only: they must set
`"synthetic": true`, are never evidence of engine correctness, and are never
counted in accuracy claims (Iron Law #9). The loader enforces the naming ⇔
flag rule in both directions.

## deal.json

All money is **integer-cent strings** (`"22500000"` = $225,000.00). Convert
workbook dollars exactly: `dollars × 100`, no floats. Ratios are plain
decimal strings at the engine's published scale (DSCR/current ratio = 2
decimals, banker's rounding; percentages = 4).

```jsonc
{
  "id": "<must equal the folder name>",
  "synthetic": false,
  "notes": "provenance: who built the workbook, when, from which documents",
  "facts": [
    // The expert's finalized spread, one row per taxonomy node value.
    // entityId is a local slug ("opco", "guarantor-jane") consistent across rows.
    {
      "entityId": "opco",
      "periodLabel": "FY2024",
      "taxonomyNodeKey": "is.net_income",
      "valueCents": "15000000",
    },
  ],
  "addbacks": [
    // Accepted add-backs from the workbook's add-back schedule.
    // Categories: officer_comp | depreciation_amortization | interest |
    //             one_time | rent_adjustment | discretionary
    {
      "entityId": "opco",
      "periodLabel": "FY2024",
      "category": "officer_comp",
      "amountCents": "8000000",
    },
  ],
  "scenario": {
    "amountCents": "120000000",
    "termMonths": 120,
    "rateSteps": [{ "fromMonth": 1, "annualRateBps": 1050 }],
    "interestOnlyMonths": 0, // optional
    "replacementSalaryCents": "6000000", // optional
    "structure": {
      // optional
      "equityInjectionCents": "12000000",
      "totalProjectCostCents": "120000000",
      "sbaGuarantyBps": 7500,
    },
  },
  "expected": [
    // The workbook's SUMMARY/ANSWERS numbers. Give exactly one of "cents" | "ratio".
    // entityId/periodLabel null = deal-global / non-period metrics.
    { "metric": "cfads", "entityId": "opco", "periodLabel": "FY2024", "cents": "22500000" },
    { "metric": "annual_debt_service", "entityId": null, "periodLabel": null, "cents": "12000000" },
    { "metric": "dscr_global", "entityId": null, "periodLabel": "FY2024", "ratio": "1.42" },
  ],
}
```

Metric keys the engine emits (see `packages/engine/src/core/compute.ts`):
`revenue_total gross_profit net_income ebitda sde cfads working_capital
current_ratio tangible_net_worth debt_to_tnw personal_income_total
personal_outflow_total personal_cash_flow global_cash_flow
annual_debt_service loan_amount term_months equity_injection_pct
sba_guaranty_pct dscr_business dscr_global`.

## Intake workflow (when the expert's workbooks arrive)

1. Drop the folder in with `proforma.xlsx` and the source documents.
2. Sit with the expert (or their written answer sheet) and transcribe the
   spread + answers into `deal.json`. Transcription is copying, not judgment
   — every number must be visible in the workbook. If the workbook and the
   engine disagree, the harness fails and a human decides who is wrong:
   **never edit `deal.json` to make the test pass** without the expert
   confirming the workbook had an error (Iron Law #9), and record the
   resolution in `notes`.
3. `pnpm test` — the new deal is enforced from that commit onward.

Rounding disagreements are findings, not noise: the engine uses banker's
rounding (round-half-even); Excel's `ROUND` is round-half-away. If a
workbook answer differs only by that rule, document it in `notes` with the
expert's ruling on which is correct for the pro-forma.
