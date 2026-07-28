# Credexis — Final Product Plan: MVP 1 → YC-Ready → Market Leader

## Context

MVP 1 (documents → verified, traceable spread) is near-complete: 98.6% precision / 0 silent
errors on a 13-doc real corpus, live app, certified-engine work queued. Deep research
(2026-07-28, three cited reports) established: the SBA software category is crowded and
funded — **Casca** ($33M, deployed at Live Oak & Huntington, the #1–2 7(a) lenders) sells
_speed_ on small-dollar loans; **Aloan** (pre-seed, zero customers) claims our exact
auditability thesis; incumbents do generic spreading without per-number lineage. The open
wedge (independently confirmed by CCG Catalyst's sector report): **full-size 7(a) files
under SOP 50 10 8 with supervisory-grade source citations and human-override history.**
Pratik will work on this full-time, onboard interns, and wants to be YC-ready. This plan
covers: the honest Casca gap analysis, what to copy vs. not, the roadmap MVP 2 → Final,
architecture evolution, a competitor-intelligence program, YC readiness, and a 90-day
action plan.

---

## Part 1 — How Casca is better than us today (honest), and what to do about it

**Where Casca genuinely beats us:**

1. **Production proof at scale** — live at the two biggest SBA lenders; thousands of loans.
   We have zero production loans. (Fix: design partners, not features.)
2. **Full loan lifecycle** — borrower-facing application portal, document collection with
   automated chasing, bank-statement cash-flow analysis, E-Tran submission, closing
   workflow. We only do the middle (documents → analysis).
3. **Borrower experience** — their AI "loan assistant" chases borrowers for missing docs
   24/7; huge adoption driver for banks.
4. **Team/capital** — funded company vs. solo founder + AI + interns.

**Where we beat Casca (verified from their public materials):**

1. **Per-number lineage** — they claim none; every Credexis number traces to a bbox.
2. **Deterministic engine** — our math is one audited engine with exact cents and golden
   tests; their public materials describe LLM-centric speed, not verifiable math.
3. **Full-size deals** — their production sweet spot is ≤$350K Express-style; SOP 50 10 8
   just made $50–350K loans require FULL underwriting — our exact strength.
4. **No rip-and-replace** — Casca replaces the bank's LOS (long, scary sale). We sit
   alongside any LOS (Aloan validated this positioning too).
5. **Policy-as-data** — SOP changes are a table update for us, a code release for them.

**Verdict on "implement their whole architecture": NO — adopt their table-stakes, keep our
spine.** Cloning Casca means fighting a $33M company where it is strongest (speed,
small-dollar, LOS replacement) while abandoning what makes us defensible (auditability).
Instead we absorb the four features that are now table-stakes for any serious player
(borrower intake portal, document chasing, bank-statement analysis, E-Tran output) on TOP
of our lineage spine — each lands in a specific MVP below.

---

## Part 2 — Roadmap: MVP 2 → Final

### MVP 2 — "Trust the math" (certify + first pilots) — ~4–8 weeks

Theme: a certified underwriting analysis a banker can defend. Mostly finishing queued work.

- Golden Excel deals reproduce expert numbers to the cent (engine certification)
- Policy pack draft→reviewed; ADR-0002 signed; auto-accept tuned to ≥99.5% precision
- Corpus to 30+ real docs (analyst's labeling week + ongoing); recall 65% → 85%+
- Hardening: virus scan wired, Sentry on, load rehearsal, ZDR letters on file
- Complete committed form families: W-2, 4562, 8825, 1125-E; verify 1065/1120 registries
- **2–3 design partners running real deals** (founding-partner pricing $10–15K/yr locked)
- Exit test: a broker we don't sit next to uploads a package and trusts the DSCR.

### MVP 3 — "The whole deal file" (parity + moat deepening) — following ~8–12 weeks

Theme: everything in a real 7(a) package + the Casca table-stakes, our way.

- **Bank-statement analysis** (new pipeline: transaction extraction → categorization →
  deposit verification, revenue corroboration vs. P&L/returns — cross-document tie-out
  gates, same lineage discipline)
- **Borrower intake portal** (lite): magic-link document upload for borrowers, checklist
  driven by deal type, automated email chasing for missing/expired docs (the Casca
  adoption feature, minus the LOS replacement)
- **SBA forms**: Form 413 Personal Financial Statement (closes the global-cash-flow gap),
  Form 1919, Form 2202 debt schedule — parsed AND generated
- **IRS transcripts live** (pick provider, ADR-0003) → "✓ verified by IRS" on tax numbers
- **Projections engine**: driver-based forecasts (occupancy/ADR for hospitality — port the
  V1 Forecasting.xlsx domain gold), pro-forma DSCR on projected cash flow
- More IRS variety: 1040 Sch A/B/D, 1099 family, 940/941 payroll cross-checks
- Multi-entity depth: EPC/OC, affiliates (SBA affiliation rules), spouses
- Eligibility pre-screen against policy pack (SOP checklist automation)

### MVP 4 — "The bank-ready output" (sell to banks at platform prices)

Theme: produce what banks submit and file; pass vendor security review.

- **Credit memo generation** — LLM narrates ONLY verified facts; every sentence cites its
  fact id → renders with source links (the first place generative prose is safe)
- **E-Tran-ready output** + 1919/1920 auto-fill; eligibility certification under the
  reviewed policy pack
- Bank-grade admin: SSO/SAML, role matrices, approval workflows, retention policies
- SOC 2 Type II audit (real auditor; our groundwork docs become evidence)
- **LSP console** (white-label multi-bank workspace) → unlocks the 1,000-lender tail via
  Windsor-class LSPs at ~$75–100/file
- LOS integrations (export/webhook into Abrigo/nCino/SPARK rather than replacing them)

### MVP 5 / Final — "The system of record for SBA credit"

- Deal lifecycle from broker intake → bank underwriting → E-Tran → closing checklist →
  servicing seams (secondary-market packaging data)
- Network effects: broker↔bank deal handoff inside Credexis (brokers package, banks
  underwrite the same verified file — two-sided lock-in)
- Adjacent programs as policy packs: SBA 504, USDA B&I, conventional small-business,
  equipment finance
- Data products (long-term, consent-gated): anonymized benchmarking (portfolio DSCR
  distributions, industry add-back norms) — the Lumos-style asset our corpus compounds into
- The moat loops keep compounding: every correction teaches the mapper; every labeled deal
  grows the corpus; every golden deal locks the engine.

---

## Part 3 — Architecture evolution (what changes per phase)

Current spine (keep forever): facts-with-lineage store · dual-reader consensus ·
deterministic cents engine · blocking gates · policy packs · append-only audit.

| Phase | New architecture pieces                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MVP 2 | None — certification + tuning of existing spine                                                                                                                                                                                                                                                                                                                                                                                                  |
| MVP 3 | `packages/bank-statements` (transaction pipeline — different problem than statements: high-volume rows, categorization taxonomy, recurring-pattern detection); borrower-portal app (`apps/portal`, separate auth surface, magic links, upload-only RLS role); `packages/projections` (driver-based forecast engine, scenario-linked); transcript provider adapter (M9 seam exists); forms-generation module (fill 413/1919/2202 PDFs from facts) |
| MVP 4 | Credit-memo generator (template + fact-citation renderer; LLM constrained to cite-or-omit); E-Tran export service; SSO (WorkOS-class); integrations layer (outbound webhooks + LOS connectors); LSP multi-tenancy (parent-org → child-bank hierarchy on existing RLS)                                                                                                                                                                            |
| MVP 5 | Deal-handoff protocol (broker→bank object transfer with consent); servicing data model; program-pack framework generalization                                                                                                                                                                                                                                                                                                                    |

Explicitly NOT planned: moving off Supabase/Vercel/Trigger (revisit only when a bank
contract demands VPC/single-tenant — the stack is portable by design).

---

## Part 4 — Competitor intelligence program (ethical, ongoing)

Standing quarterly teardown (intern-runnable, ~2 days/quarter) + live alerts. Methods —
all public/legitimate, never misrepresentation (no fake sales calls, no fake trials):

1. **Demo videos**: Finovate/conference demos (Aloan demoed FinovateSpring 2026), webinar
   recordings, YouTube product tours — frame-by-frame feature inventory.
2. **Docs & changelogs**: public docs sites (Ocrolus has full API docs), release notes,
   status pages → capability + stack signals.
3. **Job postings**: competitor engineering roles reveal stack (e.g., "LangChain",
   "Textract", "Databricks") and roadmap ("hiring E-Tran integration engineer").
4. **SBA FOIA data** (we already have the loan-level file): track volume/mix shifts at
   known Casca banks (Live Oak, Huntington, Celtic, Bankwell) quarterly — the only public
   _outcome_ signal of whether their AI actually moves throughput.
5. **Review sites + bank procurement records**: G2/Capterra, public RFPs, Vendr data.
6. **Patents/trademarks**: USPTO filings reveal claimed methods.
7. **Design-partner intel**: our pilot banks tell us what competitors pitched them
   (normal sales intelligence — document it).
8. **Accuracy benchmarking**: where legitimate self-serve trials exist (Ocrolus does),
   run OUR golden corpus through them under their ToS and score with OUR scorer —
   published as an honest bake-off. For closed products (Casca), accuracy is unknowable
   from outside; we compete on _published, reproducible_ accuracy — our scorecard IS the
   marketing weapon closed competitors can't match.
   Deliverable each quarter: one-page delta memo — new features, stack changes, customer
   wins/losses, pricing intel — filed in `docs/competitive/`.

---

## Part 5 — YC readiness

What YC actually screens for, mapped to our assets:

- **Traction**: 2–3 design partners with real deals processed (MVP 2 exit) — the #1 gap
  to close; logos > revenue at this stage
- **Metrics that pop**: deals processed, $-volume analyzed, minutes-per-deal vs. industry
  days, 0 silent errors across N deals, cost-per-deal 2¢ vs. $3–4K manual
- **Demo**: 2-minute video — upload messy 50-page package → watch split/extract →
  click a DSCR → see the source page highlight. The click-to-source moment IS the demo.
- **Founder story**: domain proximity (family hospitality businesses = the exact borrower
  profile), solo-founder + AI-native build speed (77+ CI-green PRs in 3 weeks is itself
  a YC-grade story)
- **Market narrative**: $37B/yr program, 1,400 lenders, regulatory forcing function
  (SOP 50 10 8 made underwriting mandatory exactly where it's least economic), proof of
  demand (Casca's raise + top-2 lender adoption), our wedge (auditability) with an
  analyst report naming the gap
- **Application mechanics**: apply to the next batch with whatever traction exists at
  deadline (YC rewards velocity + clarity over polish); one-liner: _"AI underwriter for
  SBA banks where every number is traceable to its source page — banks' regulators
  require what competitors can't show."_

## Part 6 — 90-day action plan

**Weeks 1–2 (now):** merge queued PRs when billing lands · Anthropic top-up · analyst
labeling week (corpus →20+) · confidence tuning · golden deals started by expert ·
ZDR letters · design-partner outreach list (20 names: NAGGL directory, mid-tier PLP
lenders from our FOIA data, broker contacts)
**Weeks 3–6 (MVP 2 close):** engine certification vs golden deals · recall push →85% ·
W-2/4562/8825/1125-E registries + labels · first design partner live · pricing validated
in partner conversations ($15K/45K/90K hypothesis) · YC application drafted
**Weeks 7–12 (MVP 3 start):** bank-statement pipeline (intern: build categorization
taxonomy + label statements) · borrower intake portal · Form 413 · transcript provider
selected (ADR-0003) · second/third design partner · first quarterly competitor teardown ·
YC submitted (if deadline falls here, submit with current traction)
**Intern allocation:** analyst-1 labeling + judgment calls (running) · intern-2 competitor
teardown + SBA forms research (413/1919/2202 field inventories) · intern-3 (when hired)
bank-statement labeling + categorization taxonomy. All intern output flows through the
same review-sheet verification discipline.

## Verification

- Each MVP has a stated exit test; the roadmap is working iff design partners advance
  MVP 2→3 without us in the room.
- KPIs tracked in /costs + a new metrics page: deals processed, auto-accept coverage,
  silent-wrong (must stay 0), per-deal cost, partner count, corpus size.
- Quarterly: competitor delta memo + FOIA volume-shift analysis validate/adjust the wedge.
