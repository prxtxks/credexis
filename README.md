<p align="center">
  <img src="apps/web/public/logo-credexis.svg" alt="Credexis" width="72" />
</p>

<h1 align="center">Credexis</h1>

<p align="center">
  <strong>SBA 7(a) underwriting automation where every number traces to its source page.</strong><br />
  Documents in. Banker-grade, examiner-ready credit spread out.
</p>

<p align="center">
  <a href="https://credexis.co">Website</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/adr">Decision records</a> ·
  <a href="docs/POSTMORTEM_V1.md">Why V2 exists</a> ·
  <a href="#security">Security</a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-64k%20LOC-3178c6" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-834%20cases-brightgreen" />
  <img alt="Attack scenarios" src="https://img.shields.io/badge/RLS%20attack%20scenarios-76%20in%20CI-blueviolet" />
  <img alt="Silent wrongs" src="https://img.shields.io/badge/silent%20wrong%20values-0-critical" />
</p>

---

## The one-paragraph pitch

A community bank underwriting an SBA 7(a) loan receives a pile of PDFs - three years of business tax returns, K-1s, personal returns for every guarantor, interim P&Ls, balance sheets, debt schedules - and pays an analyst to re-key it into Excel by hand. It takes hours per file, it is error-prone, and when the examiner asks "where did this number come from," the answer is a shrug and a file hunt. Credexis reads that pile with two independent extractors that must agree to the cent, runs six deterministic validation gates, cross-checks the borrower's return against the IRS's own transcript, computes DSCR and global cash flow in a single server-side engine on integer cents, and hands the banker a workspace where **every dollar figure is one click from the exact rectangle on the source page it came from**. The AI is never allowed to do arithmetic or invent a value. That constraint is the whole product.

---

## Table of contents

1. [The market: what SBA 7(a) is and why now](#the-market-what-sba-7a-is-and-why-now)
2. [The problem](#the-problem)
3. [What Credexis does](#what-credexis-does)
4. [How we stand out](#how-we-stand-out)
5. [Architecture](#architecture)
6. [The iron laws](#the-iron-laws)
7. [Accuracy, measured honestly](#accuracy-measured-honestly)
8. [Security](#security)
9. [Repository layout](#repository-layout)
10. [Running it](#running-it)
11. [Status and roadmap](#status-and-roadmap)
12. [Team](#team)

---

## The market: what SBA 7(a) is and why now

The **SBA 7(a) program** is the U.S. Small Business Administration's flagship loan guarantee. Banks make the loans; the federal government guarantees 75-85% of them. It is how a dentist buys a practice, how a franchisee opens a second location, how a hotel changes hands - the credit engine of Main Street.

**The scale (FY2025, computed from data.sba.gov):**

|                                        |                                            |
| -------------------------------------- | ------------------------------------------ |
| Loans approved                         | **78,078**                                 |
| Dollar volume                          | **$37.29 billion** - a record year         |
| Average loan                           | **$477,000**                               |
| Active lenders                         | **1,426**                                  |
| Lenders with delegated (PLP) authority | **~584**, originating **64%** of all loans |

Every one of those loans has to be underwritten to a federal standard - the SBA's _Standard Operating Procedure 50 10_ - because the guarantee is only honored if the file holds up. That makes 7(a) underwriting one of the most **documentation-heavy, audit-exposed** workflows in commercial banking.

**Why now: SOP 50 10 8.** Effective June 2025, the SBA's latest rulebook revision:

- requires **full underwriting on every loan down to $50,000** (small loans were previously credit-scored);
- restored the **10% equity injection** requirement on complete changes of ownership;
- raised the small-business credit-score cutoff.

Translation: banks must now do _more_ required underwriting work per file, on their _least_ profitable loans, with the same headcount. Automation was nice-to-have; it is now an economic necessity. But not just any automation - an examiner will not accept a number a bank cannot explain. **The only automation that survives an SBA exam is automation that shows its work.** That is the product thesis, and an independent bank-technology analyst report (CCG Catalyst) named exactly this gap - full-size 7(a) files under SOP 50 10 8 with supervisory-grade source citations and preserved human-override history - as the market's unmet need.

## The problem

Today a credit analyst:

1. Receives 150-500 pages of borrower documents, often a single CPA-prepared bundle with the 1120-S, K-1s, depreciation schedules, and rental schedules stapled together.
2. Splits it by eye, identifies each form and tax year (the IRS renumbers lines between years, so a 2021 return and a 2024 return read differently).
3. Re-keys hundreds of values into an Excel spreading template - by hand, from the PDF.
4. Builds the "spread": revenue through EBITDA, add-backs, cash flow available for debt service, guarantor personal cash flow, global cash flow, and the ratio the whole loan hinges on, **DSCR**.
5. Cross-foots subtotals, ties the tax return to the P&L, checks the balance sheet balances - or, under deadline, doesn't.
6. Projects a pro-forma, grades it against SBA thresholds, writes the memo, and hopes the numbers survive credit committee and, later, the examiner.

Every step is slow. Several are silently error-prone: a blank cell shifts a column and 2024's revenue lands under 2023; a smudged "8" reads as "3"; a doctored PDF sails through because nobody re-checks the return against what was actually filed with the IRS. And when a number is challenged eighteen months later, reconstructing _why_ it was entered is archaeology.

The market has answered with **speed** tools - AI that spits out a spread fast. But speed without per-number evidence _creates_ exam risk rather than reducing it. Nobody credible sells **auditability**. We do.

## What Credexis does

Upload the pile. Credexis:

| Stage                | What happens                                                                                                                                                                                                                                                                        | Why it matters                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Ingest**           | Every file is SHA-256 fingerprinted and security-screened in-house before anything reads it                                                                                                                                                                                         | Borrower PII never leaves the platform - not even for virus scanning                                          |
| **Split & classify** | Bundles are split into logical documents by printed-form signals; an LLM only handles leftovers, and its claims are structurally validated by code                                                                                                                                  | A page that merely _cites_ Form 1125-E cannot be misfiled as one; unsure pages go to a human, never guessed   |
| **Extract, twice**   | Every tax form is read by two independent systems - a geometry-aware document AI and a vision model bound to transcribe or return `null`                                                                                                                                            | The two readers cannot see each other's answers; the code has no channel for it                               |
| **Reconcile**        | A deterministic reconciler accepts a value only when both readings match to the exact cent _and_ the form's own printed arithmetic holds                                                                                                                                            | Anything else routes to human review with the source pixels on screen                                         |
| **Validate**         | Six gates: subtotals cross-foot (±$1), balance sheet balances (±$2), tax return agrees with the P&L, IRS form-internal math holds, IRS transcript matches, year-over-year swings are sane                                                                                           | A value that fails a gate **cannot** be auto-accepted - the veto is the first branch in the confidence scorer |
| **Verify**           | With borrower e-consent (Form 8821), every parsed value is compared cent-for-cent against the IRS's own transcript                                                                                                                                                                  | Match earns a verified badge; mismatch raises a _possible document tampering_ flag                            |
| **Compute**          | One server-side engine computes the full spread on integer cents - EBITDA, SDE, CFADS, working capital, tangible net worth, guarantor and global cash flow, SBA-convention debt service, business and global DSCR - stamped with the engine version and the SBA policy-pack version | The screen, the Excel export, and the audit log cannot disagree, because they are the same number             |
| **Decide**           | The banker reviews in a purpose-built workspace, overrides with full history, grades against versioned SOP thresholds, and exports a six-tab branded workbook                                                                                                                       | The machine can advance a deal to Review; only a human can mark it Complete                                   |

**The hero interaction:** click any number in the spread and the actual PDF page renders beside it with a highlighted rectangle around the printed value - document, page, extraction method, confidence, and the full supersession chain if a human ever touched it. "The click-to-source moment is the demo."

**The borrower portal:** the applicant clicks an emailed link, types their email, and sees one plain page - what to send, what arrived, what the loan officer asked for. No account, no password. The checklist ticks itself as the pipeline recognizes each uploaded form. One polite reminder, automatically. Of the database's access policies, a borrower's login can reach exactly two - both scoped to their own upload folder.

## How we stand out

Every competitor in this category sells one of two things: generic commercial spreading with SBA as an afterthought, or AI-native speed on small-dollar loans that requires ripping out the bank's loan origination system. Our differentiation is structural, not cosmetic:

1. **Per-number lineage is a schema requirement, not a feature.** Every stored fact must carry a source bounding box on a source page, an IRS transcript line, or an explicit human input. There is no fourth source shape. An invented number is _unrepresentable_.
2. **The AI never touches the math.** LLMs classify labels, locate fields, and split documents. In statement mapping - the only LLM step in that path - the model classifies line labels and never sees a number. Every dollar figure is read mechanically from the page or typed by a person.
3. **Deterministic, versioned engine on integer cents.** Money is a branded `bigint` of cents; mixing a float with money is a compile error, a lint error, and a CI failure - three independent layers. Ratios are exact fixed-point: a DSCR of 1.15 is exactly 1.15, never 1.1499999 flipping a policy decision.
4. **Anti-fraud built into the gates.** Comparing the borrower's return against the IRS transcript turns verification into document-tampering detection - a control parse-only tools do not have.
5. **Policy as data.** SOP 50 10 8 thresholds live in a versioned `policy_packs` table with an SOP citation on every rule. When the SBA revises the rulebook, a new pack ships as data; every deal permanently keeps the pack it was underwritten under.
6. **Sits alongside your LOS.** No rip-and-replace. Bankers keep their system of record and add the audit trail their examiners ask about.
7. **Learns your portfolio.** Confirmed label mappings are remembered per lender; a second identical statement costs zero LLM calls. Your corrections stay yours.
8. **Honesty as engineering.** Synthetic test fixtures are barred from accuracy claims _by code_ - a fake document that tries to count throws an exception. Ground truth is cryptographically bound to the SHA-256 of the PDF it grades and is never edited to make an eval pass. A wrong value that slips past human review is tracked as its own metric, called "the cardinal sin" in the code, and a single occurrence fails the build.

## Architecture

```
                         ┌──────────────────────────────────────────────────┐
  borrower / banker ──►  │  apps/web  (Next.js App Router + tRPC)           │
  borrower ──────────►   │  apps/portal (separate origin, zero privileged   │
                         │              keys, zero underwriting code)       │
                         └───────────────┬──────────────────────────────────┘
                                         │ JWT verified on every route
                                         ▼
  ┌──────────────┐   ┌───────────────────────────────┐   ┌────────────────────┐
  │ packages/    │   │ packages/pipeline (Trigger.dev)│   │ packages/engine    │
  │ extraction   │◄──│  ingest → split → extract x2  │──►│ ONE calc engine    │
  │ adapters,    │   │  → consensus → gates → facts   │   │ integer cents,     │
  │ registry,    │   └───────────────┬────────────────┘   │ versioned, pure,   │
  │ transcripts  │                   │                    │ server-only        │
  └──────────────┘                   ▼                    └─────────┬──────────┘
                     ┌────────────────────────────────┐             │
                     │ packages/schema (Drizzle)       │◄────────────┘
                     │ Postgres + RLS on every table   │
                     │ append-only, hash-chained audit │
                     └────────────────────────────────┘
                                     ▲
                     ┌───────────────┴────────────────┐
                     │ packages/eval  golden corpus,   │
                     │ exact-cent scorer, CI gate      │
                     └────────────────────────────────┘
```

**Stack:** pnpm + Turborepo · TypeScript end to end · Next.js App Router + tRPC · Trigger.dev v4 (durable pipeline tasks, hard 10-minute ceiling per stage, documents processed in parallel) · Supabase (Postgres / Auth / Storage) + Drizzle · extraction vendors behind an `ExtractorAdapter` seam (swapping a vendor is configuration, not a rewrite - see [ADR-0002](docs/adr)) · AG Grid workspace · exceljs export.

**Design principles that shape everything** are written up in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Non-trivial choices are recorded as [architecture decision records](docs/adr) with the data that drove them - including the vendor bake-off where a major cloud provider's tax model was benched after it hallucinated forms that were not in the file.

## The iron laws

These live in [`CLAUDE.md`](CLAUDE.md) at the repo root and are enforced by tests, lint rules, and CI - violating one is a bug even if tests pass:

1. **LLMs never do arithmetic and never invent values.** They classify, locate, and split. Every number traces to a source bbox, an IRS transcript line, or an explicit human input.
2. **All money is integer cents (`bigint`).** A raw `number` never holds a monetary value.
3. **`packages/engine` is the only place metrics are computed.** Server-side only. The client renders; a CI grep fails the build if UI code does arithmetic on money.
4. **Values bind to periods by geometry, never by ordinal position.** A blank cell cannot shift a column.
5. **Facts are append-mostly.** Overrides supersede, never mutate. Lineage is required on every fact.
6. **Validation gates are blocking.** Failing fields cannot auto-accept.
7. **Every route verifies the JWT; every tenant table has RLS; the service-role key never appears in a request path.**
8. **SBA thresholds come from the versioned policy-pack table, never hardcoded.**
9. **Never edit golden-corpus ground truth to make an eval pass. Never count synthetic fixtures in accuracy claims.**
10. **Docs change in the same PR as behavior. Dead code is deleted the day it dies.**

Each law is the named antidote to a specific failure documented in [docs/POSTMORTEM_V1.md](docs/POSTMORTEM_V1.md) - the forensic autopsy of our own first version, which failed in eleven precisely catalogued ways (positional year mapping, three DSCR implementations that disagreed, float drift, validation that ran but displayed nothing, a test suite with zero real documents). We know exactly how document-AI underwriting goes wrong because ours did, and V2 was built so each failure is architecturally impossible.

## Accuracy, measured honestly

We grade ourselves the way an examiner would - against a **golden corpus of real, human-labeled borrower documents**, scored to the **exact integer cent**. A value is identical to the human label or it is wrong; there is no "close enough."

From the current scorecard (August 2026 - 20 real documents, 367 human-verified fields, live production extractors):

- **99.7% field precision** across all document types.
- **97.3% field recall** - up from 64% in July, after a miss-by-miss autopsy of every field the system failed to read. Recall is the number vendors usually hide; we publish ours because a wrong number nobody catches is worse than a gap somebody fills.
- **Zero silent wrong values** in every recorded round, ever. When Credexis writes a number into the file, it has never been silently wrong. What it is not sure about, it refuses and routes to a human _with the source page attached_.
- **100% precision on tax-form families and balance sheets - including scanned documents.**

The methodology is itself the differentiator: labels are hash-bound to the exact PDF bytes they describe (the loader refuses mismatches), synthetic fixtures are quarantined by enforced naming and reported in a separate section, and a merge that regresses per-field accuracy more than 0.2 points is blocked. The page classifier is separately stress-tested against **1,153 pages of public IRS filings** with zero confident misclassifications.

A real deal proved the loop end to end: a multi-entity hotel acquisition - **29 documents, ~480 pages, six related entities** - ran through the deployed pipeline producing **1,025 traceable facts**, and the automated pro-forma reproduced the bank's own hand-built Excel workbook **to the cent**.

## Security

Bank buyers are security reviewers first. Almost every control below is enforced by the database or by CI, not by convention:

- **Tenant isolation at the database layer.** Postgres Row-Level Security on every table, deny by default. A CI test parses the migration SQL and fails the build if any new table lacks a policy.
- **Adversarially tested, every merge.** A dedicated CI job boots a throwaway Postgres 17, applies the real production migrations, and runs **76 impersonated-attacker scenarios**: cross-tenant reads by guessed ID, viewers attempting writes, deactivated accounts, forged storage paths, and 42 borrower-portal attacks including a rogue database superuser (also refused - a trigger makes a document's path, hash, tenant, and uploader immutable once it lands).
- **Identity re-verified on every request** against the auth server; every failure mode defaults to signed-out. Four role tiers enforced twice (API middleware and RLS), with a build-time check that no write endpoint can be wired below underwriter tier.
- **The privileged key is designed out.** The RLS-bypassing service-role key never appears in a request path; background processing runs as a deliberately weak database role scoped to pipeline tables and one bucket.
- **Tamper-evident audit log.** Every mutation to financial data is journaled by database triggers into a log that is append-only at the privilege level - `UPDATE`/`DELETE` revoked even from the service role - and **SHA-256 hash-chained per tenant**. Altering any historical row breaks every hash after it; a one-click in-app verification names the first broken link. Bank admins run it themselves.
- **Borrower data stays inside.** Uploads are structurally scanned in-house (magic bytes, embedded-JavaScript and launch-action rejection) precisely because third-party AV APIs would ship PII out. No AI or extraction vendor sees a real tax document until its zero-data-retention posture is confirmed in writing - a standing rule in the subprocessor register.
- **Secrets discipline.** Full-git-history secret scanning on every merge, a control born from a documented V1 key leak - and we say so.
- **Compliance posture, stated precisely:** SOC 2 controls are operating and documented (quarterly access reviews, PR/CI change management, subprocessor register); the formal audit is scheduled with the first bank pilot. Incident runbooks classify "wrong values reaching a lender" at the same severity as a data breach.

## Repository layout

```
apps/
  web/            banker workspace: Next.js + tRPC, source viewer, review queue,
                  audit page, branded XLSX export
  portal/         borrower upload portal - separate deployment, no shared code
packages/
  engine/         the ONE calculation engine: metrics DAG, gates G1-G6, add-backs,
                  amortization, pro-forma, policy-pack evaluation
  extraction/     ExtractorAdapter seam, dual-path consensus reconciler, versioned
                  IRS Form Registry (13 families x TY2020-2025), statement chain,
                  transcript provider seam
  pipeline/       Trigger.dev tasks: ingest, split/classify, extract, scan, chase
  schema/         Drizzle schema, 38 migrations, RLS policies, audit hash chain,
                  the 76-scenario RLS harness
  eval/           golden corpus loader, exact-cent scorer, bake-off runner, CI gate
  corpus-tools/   labeling and PII-scan intake for the golden corpus
  shared/         money primitives (Cents, FixedDecimal, banker's rounding),
                  number normalizer, limits
docs/
  ARCHITECTURE.md · POSTMORTEM_V1.md · adr/ · runbooks/ · soc2/ · design/
```

**By the numbers:** ~64,000 lines of TypeScript · 834 test cases across 89 files · 38 migrations · 5 ADRs · 109 merged PRs · one product that has already failed once and been rebuilt correctly.

## Running it

```bash
pnpm install
pnpm db:migrate && pnpm db:seed     # Drizzle migrations + taxonomy/policy seeds
pnpm dev                            # web + portal
pnpm test                           # unit + integration
pnpm eval                           # golden-corpus scorecard (must not regress vs eval-baseline.json)
```

Requires a Supabase project, a Trigger.dev project, and extraction-vendor keys; see [docs/environments.md](docs/environments.md). The golden corpus's real PDFs are held privately (they contain borrower-style PII); only their hashes and labels are committed.

## Status and roadmap

**Shipped and running on a deployed pipeline:** the full loop - ingest, split, dual extraction, consensus, six gates, fact store with lineage, click-to-source workspace, review queue, calc engine, policy packs, pro-forma, branded six-tab Excel export, borrower portal, IRS-transcript verification engine (running against a sandbox data provider; production feed launches with first bank partners).

**Next:** bank-statement analysis, SBA Forms 413/1919/2202, credit-memo generation where every sentence cites a fact ID, E-Tran output, SSO/SAML, SOC 2 Type II, LOS integrations. Full sequence in [docs/ROADMAP.md](docs/ROADMAP.md).

We are onboarding a small group of SBA lenders as **founding design partners** to shape the rest, with lineage and audit features in every tier - trust is never paywalled - and lender-paid, non-contingent fees the way SBA rules (13 CFR 103 / 120.221) require.

## Team

**Pratik Chaudhari** - Co-founder, engineering & AI. **Lakesh Khanal** - Co-founder, SBA finance. Built by an SBA finance specialist and an AI engineer who watched manual spreading eat the week.

**Contact:** [credexis.co](https://credexis.co) · uxoryllc@gmail.com

---

<p align="center"><sub>Credexis is a product of Uxory LLC. SBA program figures computed from public data at data.sba.gov.</sub></p>
