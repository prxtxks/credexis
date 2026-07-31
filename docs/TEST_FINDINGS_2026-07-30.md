# First full-deal walkthrough - findings (2026-07-30)

Document: `ats-1120-s12.pdf` - IRS ATS test scenario 12, Tax Year 2023,
Maker Company US, Inc. (EIN 00-0000112), 14 pages.
Source: https://www.irs.gov/pub/irs-efile/1120-mef-ats-scenario-12-ty23.pdf

Deal: "Maker Company US - Acquisition", type business acquisition,
entity "Maker Company US, Inc." (target).

## Ground truth for the document

| PDF pages | Actually is                                                  |
| --------- | ------------------------------------------------------------ |
| 1         | IRS scenario cover sheet (not a tax form)                    |
| 2         | Form 1120 page 1 - income and deductions                     |
| 3-7       | Form 1120 pages 2-6 (Sch C, J, K, K cont., L Balance Sheets) |
| 8-14      | Form 4626 - Alternative Minimum Tax, 7 pages                 |

Schedule L (page 7) is **blank** in this scenario - no balance-sheet values
are printed, so nothing was lost by not spreading it here.

## What works, verified line by line

Every value the Tax Spread produced matches the printed return exactly.
Checked against `pdftotext -layout` of page 2:

| Line                         | Extracted     | On the form   |     |
| ---------------------------- | ------------- | ------------- | --- |
| 1a Gross receipts            | 1,500,000,000 | 1,500,000,000 | ok  |
| 1c Balance                   | 1,500,000,000 | 1,500,000,000 | ok  |
| 2 COGS                       | 500,000,000   | 500,000,000   | ok  |
| 3 Gross profit               | 1,000,000,000 | 1,000,000,000 | ok  |
| 11 Total income              | 1,000,000,000 | 1,000,000,000 | ok  |
| 13 Salaries and wages        | 800,000,000   | 800,000,000   | ok  |
| 27 Total deductions          | 800,000,000   | 800,000,000   | ok  |
| 28 Taxable income before NOL | 200,000,000   | 200,000,000   | ok  |
| 30 Taxable income            | 200,000,000   | 200,000,000   | ok  |
| 31 Total tax                 | 64,500,000    | 64,500,000    | ok  |

**Officer compensation (line 12) is legitimately blank on this return.** Its
absence from the spread is correct, not a miss.

Taxonomy mapping into the Income Statement is also correct: revenue, COGS,
gross profit, salaries, operating income, income before taxes, and income tax
expense all land on the right nodes with the right values.

The deterministic splitter is sound as of PR #177: the IRS signal-sweep
(`packages/eval/src/signal-sweep`, 69 public docs / 1153 pages) scores
**0 wrong, 0 suspect** on current main.

## Issues

### P0-1 - The LLM classifier has no citation guard

PDF page 2 (Form 1120 page 1, the single most important page in the return)
was classified as **1125E**. The page prints
`Compensation of officers (see instructions - attach Form 1125-E)`.

The deterministic layer **correctly abstained** on this page (verified:
`formFamily: null, confidence: 0`). It fell through to the Anthropic page
classifier, which read the citation as an identity.

PR #177 added exactly this guard (`REFERENCE_CONTEXT_RE`) to the regex path
in `packages/extraction/src/split/signals.ts`. **It was never ported to the
LLM path.** The deterministic hole is closed; the probabilistic one is open.

Impact if unconfirmed by a human: extraction runs the 1125-E registry, which
knows only officer comp. Revenue, COGS, gross profit and net income are never
extracted, and the spread looks plausible while missing its core.

Fix: port both #177 invariants into `packages/extraction/src/split/classify.ts`

- a token preceded by a reference verb is a citation, never an identity; and
  an unrecognized form must return null rather than the nearest known family.

### P0-2 - Unknown forms snap to the nearest known family

Form **4626** (Alternative Minimum Tax) is not in `formFamilySchema` at all.
The classifier labelled its pages:

- pages 8-9 -> **4562** (Depreciation and Amortization - one digit apart)
- page 10 -> **1120**
- pages 11-14 -> **4562**

Page 10 as 1120 is the dangerous one: AMT figures can be extracted into the
1120 spread against 1120 field definitions.

Fix: same abstention rule as P0-1, plus add 4626 as a **known-but-unsupported**
family so these pages can be labelled honestly and excluded from extraction
rather than silently relabelled.

### P0-3 - No concept of a non-form page

PDF page 1 is an IRS scenario cover sheet. It was labelled **1120**. There is
no family meaning "this page is not a tax form", so cover sheets, fax
banners, and separator pages must be mislabelled as something.

Fix: add a `NON_FORM` family, excluded from extraction.

### P1-1 - "derived" chip on directly-extracted values

The Tax Spread tags line **1a Gross receipts or sales** with a `derived` chip.
That number is printed on page 2 and was read from the page.

Root cause: the chip renders on `registryOnly`, which means "this registry
field carries no taxonomy placement" (`apps/web/src/server/spread/tax-logic.ts`).
`f1120.line1a` has no `taxonomyNodeKey` because `1c` is the line that maps to
`is.revenue.total`. So the flag is right and **the word is wrong**.

This matters more than it looks. Telling an underwriter that a directly
extracted number was "derived" is the exact inverse of the truth, and
auditability is the product's whole wedge. In a bank exam this is a
credibility problem, not a cosmetic one.

Fix: rename the chip to `tax-only` or `unmapped` in
`apps/web/src/components/workspace/tax-spread-grid.tsx`. Reserve the word
"derived" for values the engine actually computes.

### P1-2 - Money is truncated in both grids

Income Statement renders `$1,500,000,000.` and `$1,000,000,000.` clipped at
the column edge. Tax Spread renders `$1,500,000,0…` with an ellipsis.

A banker-grade spread cannot clip currency. Fix: size the value columns to
content, right-align, tabular numerals, and never ellipsize a monetary cell.

### P2-1 - Balance Sheet tab can never populate from a business return

The business-return registry (`packages/extraction/src/registry/data/business-returns.ts`)
maps **no `bs.*` taxonomy nodes**. Every field targets `is.*`. Schedule L is
therefore never spread, on any 1120/1120S/1065.

Blank in this scenario, so nothing was lost here, but the mapping gap is real
and will surface on the first return with a populated Schedule L.

### P2-2 - Deal status stayed "Parsing" after extraction completed

Extraction finished and produced 10 review-queue items, but the deal status
still reads **Parsing**. Confirm whether status is meant to advance to
**Review** automatically, and wire it if so.

### P2-3 - Borrower portal uploads never enter the pipeline

Carried over from earlier the same day, still open. `borrower_attach_upload`
(migration 0030) inserts the `documents` row and audits it, but nothing
enqueues the Trigger.dev `ingest-document` task. The only caller of
`triggerIngest` is `apps/web/src/app/api/upload/route.ts:170`. Verified
against the production database: `documents` carries only the audit, path
guard and upload-limit triggers - no webhook, no enqueue.

A borrower's file lands in storage and sits there permanently.

Recommended fix (design decision, deliberately not taken unilaterally): a
scheduled sweeper on the staff side that picks up documents with no
extraction run, rather than giving the borrower deployment a Trigger.dev
secret and the deal identifiers it is currently and deliberately denied.

## Verification notes for whoever picks this up

- **Rebuild before measuring.** The sweep and evals run out of `dist/`. A
  stale build produced a false report of 13 hard failures earlier today that
  were already fixed on main. `pnpm --filter @credexis/<pkg> build` first.
- The sweep is the regression test for anything touching classification:
  `node packages/eval/dist/signal-sweep/cli.js run --dir <corpus>`; it exits
  non-zero on hard failures.

## Resolution updates

**P2-1 resolved (M13.4, 2026-07-31):** the business-return registries map
Schedule L to `bs.*` taxonomy nodes for 1120, 1120-S, and 1065 -
END-OF-YEAR column only (column d; the beginning column is the prior
period, whose honest source is a prior-year upload). Line numbering
verified against the official 2023 printed PDFs; the 1065's divergent
numbering (assets end at L14, partners' capital at L21) is respected.
Each form carries a registry relation asserting total assets = total
liabilities & equity. The Balance Sheet tab populates from the next
extraction of a return with a filled Schedule L.

**P2-2 resolved (2026-07-31):** the parsing→review advance was correct in
code all along - the DEPLOYED worker was stale. Verified live after the
worker redeploy: a fresh upload advanced its deal to Review
automatically.

**P2-3 resolved (M13.3, #181):** the staff-side sweeper
(`sweep-orphan-documents`, cron \*/10) enqueues ingest for documents with
no run - it rescued its first real document in production the same day.

## Resolution (M13.1, same day)

P0 shipped: 4626 and NON_FORM exist as honesty labels; 4626 has a
deterministic pattern (its pages never reach the LLM); the LLM contract now
requires the printed form number, the code maps print → family fail-closed,
and a claim whose only textual basis is a citation is vetoed
(`validateLlmClaim`, guards shared with signals.ts). Bonus finding while
verifying against this very PDF: the text layer GLUES columns
("Form 1120Department of the Treasury"), and the suffix lookaheads from
corpus-1 wrongly treated the glued letter as a sibling-form suffix - page 2
abstained deterministically for that reason alone. Sibling suffixes are
always dashed (or bare S), so glued letters now match: page 2 classifies
1120 @ 0.98 without any LLM involvement.
