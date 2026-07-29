# Credexis V2 — Master Task List for Claude Code (Opus)

Companion to `ARCHITECTURE.md` (the spec) and `POSTMORTEM_V1.md` (the traps). Execute milestones in order; tasks within a milestone are ordered so nothing blocks. Tasks tagged **[PRATIK]** need human input — surface them early, never invent their content.

---

## Standing orders for Opus (read before every session)

1. **The blueprint is law.** The ten principles in Blueprint §2 override any convenient shortcut. If a task seems to conflict with a principle, stop and flag it — do not improvise.
2. **LLMs never compute or invent numbers.** Anywhere. If you find yourself prompting a model to "calculate" or "estimate" a value, you are off-spec.
3. **All money is integer cents (`bigint`).** `number` may not hold a monetary value in any file. Add the ESLint rule in M0.6 and never disable it.
4. **TDD against fixtures for every parser/engine change.** Write the failing test with a real fixture first. Golden-corpus evals must pass in CI before merge; never edit ground-truth files to make a test pass.
5. **No dead code, no divergent docs.** V1 died with three contradicting narratives. If you change behavior, change `/docs` in the same PR. Delete superseded code immediately.
6. **Every route authenticated, every table RLS'd.** New table without an RLS policy = failing CI check (M2.7).
7. **Small PRs, conventional commits, one task ID per branch** (`m4-3-consensus-reconciler`). Reference the task ID in the commit body.
8. **When blocked on a [PRATIK] task, skip forward** within the milestone; never fabricate sample data that pretends to be real ground truth.
9. **Cost discipline:** every external API call path must write to `extraction_runs` cost tracking (M3.2). No untracked spend.
10. **Definition of Done for every task:** code + tests + docs updated + lint/typecheck/CI green + task's acceptance criteria demonstrably met.

---

## M0 — Foundations (no product code before this is green)

- **M0.1 Scaffold monorepo.** pnpm + Turborepo; packages: `apps/web` (Next.js App Router, TS strict), `packages/engine`, `packages/schema` (Drizzle + zod), `packages/extraction`, `packages/shared`. Node LTS pinned; `.nvmrc`; strict tsconfig base.
  _Accept:_ `pnpm build && pnpm typecheck` green on fresh clone.
- **M0.2 Tooling.** ESLint (flat config) + Prettier + lint-staged + husky; vitest workspace; Playwright installed in `apps/web`.
  _Accept:_ a sample failing test fails CI locally.
- **M0.3 CI pipeline** (GitHub Actions): typecheck, lint, unit tests, build, Playwright smoke, plus placeholder `eval` job (wired for real in M1.4). Cache pnpm/turbo.
  _Accept:_ PR to main runs all jobs; red job blocks merge (branch protection).
- **M0.4 Environments & secrets.** `.env.example` (no values); doppler/1Password/Vercel envs documented in `/docs/environments.md`; `*.json` keys and `*.pem` in `.gitignore`; add gitleaks secret-scan step to CI (the V1 leak must be structurally impossible).
  _Accept:_ gitleaks passes; committing a fake key fails CI.
- **M0.5 Provision services** **[PRATIK]**: new Supabase project (fresh — do not reuse V1's), Vercel project, Trigger.dev org, Sentry, vendor API keys (Reducto/Extend/Azure DI/Anthropic) as they're procured. Record which are live in `/docs/environments.md`.
- **M0.6 Money-safety lint rule.** Custom ESLint rule (or shared branded type `Cents`) forbidding arithmetic on raw `number` in `packages/engine` and any file importing money types; fixed-point decimal utility in `packages/shared` (bigint cents; banker's rounding; division helpers) with exhaustive unit tests including the classic float-failure cases.
  _Accept:_ `0.1 + 0.2` class bugs impossible in engine package; utility 100% branch-covered.
- **M0.7 `/docs` skeleton + CLAUDE.md.** Copy blueprint + post-mortem into `/docs`; write `CLAUDE.md` from `04_CLAUDE_MD_SEED.md`; ADR template + ADR-0001 (stack) recorded.

**Exit gate M0:** fresh clone → green CI in one command; secret scan active; no service keys in repo.

---

## M1 — Golden corpus & eval harness (BEFORE any extractor)

- **M1.1 Corpus schema.** Define ground-truth JSON format: per document → `(form_family, tax_year, entity, fields[]: {registry_field_id | taxonomy_node, period, value_cents, page, bbox?})`. Store under `corpus/` in a private bucket + git-lfs pointer manifest (never public git).
- **M1.2 Corpus intake tooling.** CLI: drop a PDF + fill a YAML ground-truth template → validated into corpus format (zod). Include redaction helper (SSN/EIN masking) using deterministic regex + manual confirm step.
- **M1.3 Seed corpus** **[PRATIK]**: 30–60 real redacted docs per Blueprint §9 — every MVP form family × {native, scanned, skewed} × ≥2 tax years; ≥10 varied P&Ls (QuickBooks, CPA-formatted, hand-built) and ≥6 balance sheets. Pratik + domain expert label via M1.2 tooling. _This is the single highest-leverage human task in the project._
- **M1.4 Eval harness.** `pnpm eval` runs configured extraction pipeline against corpus → per-field precision/recall, per-form breakdown, auto-accept precision & coverage, "silent wrong value past review" count (must be 0), cost per doc; writes JSON + markdown report; CI job compares against `eval-baseline.json` and fails on regression beyond thresholds.
  _Accept:_ harness runs with a trivial mock extractor end-to-end; baseline mechanism proven by intentionally regressing a fixture.
- **M1.5 Synthetic fixture pack** (unblocks M3–M5 while M1.3 is in flight): 10 programmatically generated PDFs (known layouts, known values) for unit tests. Clearly labeled synthetic; never counted in accuracy claims.

**Exit gate M1:** `pnpm eval` produces a real scorecard; ≥15 real docs labeled (partial corpus OK to proceed, keep growing).

---

## M2 — Data model, auth, tenancy

- **M2.1 Drizzle schema v1:** tenants, users/profiles, deals, entities, documents, logical_documents, pages, periods, facts, extraction_runs, addbacks, loan_scenarios, computed_metrics, issues, audit_log, taxonomy_nodes, form_registry, learned_mappings, policy_packs — exactly per Blueprint §5. Migrations + seed script.
- **M2.2 RLS policies** for every tenant table (tenant_id derivation from JWT); pipeline worker role with scoped grants — **no service-role key in request paths**.
- **M2.3 Supabase Auth wiring** (Google OAuth + email); middleware route guards; roles admin/underwriter/viewer enforced server-side in tRPC context.
- **M2.4 Storage layout:** per-tenant prefixes, signed short-TTL URLs, upload size/type limits, SHA-256 content hash dedupe.
- **M2.5 Audit log writer:** middleware that records every fact/addback/scenario mutation (before/after, actor). Append-only (revoke UPDATE/DELETE).
- **M2.6 Seed taxonomy v1** (~200 nodes, SBA-oriented; officer comp, D&A, interest, rent as first-class nodes) + **seed policy_pack v2026-03** (DSCR ≥1.15 standard / ≥1.10 small ≤$350k, 10% equity injection on changes of ownership, term limits). Values reviewed by **[PRATIK]** against current SOP 50 10 8 text.
- **M2.7 CI schema checks:** migration drift check; "every new table has RLS" assertion test.

**Exit gate M2:** two seeded tenants cannot see each other's rows (integration test proves it); audit log captures a fact override.

---

## M3 — Ingestion, split/classify, extractor adapters

- **M3.1 Upload flow:** drag-drop multi-file (PDF/XLSX/images) → storage → `documents` row → Trigger.dev `ingest` run; virus scan step; live status via Realtime.
- **M3.2 `extraction_runs` instrumentation:** every stage records timings, extractor+model versions, page counts, and cost. Dashboard-queryable.
- **M3.3 ExtractorAdapter interface** in `packages/extraction`: `parseLayout(doc) → pages/tables/cells+bbox`, `extractFields(doc, schema) → {field, value_text, bbox, confidence}[]`. Implement adapters: Reducto, Azure Document Intelligence (prebuilt-tax + layout), Anthropic vision (structured outputs, null-when-absent prompting, temp 0). Each behind env-gated config; contract tests with synthetic fixtures; golden-value recorded responses for CI (no live calls in CI).
- **M3.4 Vendor bake-off** (needs M1.3 partial): run each adapter over the corpus via the eval harness; produce `/docs/adr/ADR-0002-extractor-selection.md` with per-form accuracy + cost tables; **[PRATIK]** signs off on primary/secondary selection.
- **M3.5 Split & classify stage:** page render → thumbnails; deterministic IRS form/OMB-number detection first, vision-LLM page classification second; group pages → `logical_documents` with (form*family, tax_year, entity_hint); duplicate detection by hash. Human-confirmable assignment API (UI in M6).
  \_Accept:* mixed 60-page synthetic bundle splits correctly; eval-harness classification accuracy reported.
- **M3.6 Number normalizer** in `packages/shared`: full spec per Blueprint §4.4 → integer cents. Exhaustive table-driven tests (all formats incl. `(500)`, EU separators, thousands-scaling, dash-vs-null). _This module is used by every later stage — get it perfect now._

**Exit gate M3:** upload → split → classified logical documents visible via API, with costs tracked; bake-off ADR merged.

---

## M4 — Tax-form extraction (vertical slice: consensus pipeline)

- **M4.1 Form Registry v1:** data files for 1120-S, 1120, 1065, 1040 (+ Sch 1/C/E), K-1 (1120-S & 1065), 4562, 8825, 1125-E, W-2 × tax years 2023–2025: field ids, line numbers, aliases, page hints, dtype, sign, cross-field relations. Loader + zod validation + registry unit tests. **[PRATIK]** reviews field lists against real underwriting needs.
- **M4.2 Path-1 extraction stage:** route logical_document → primary adapter with registry-derived schema → candidate facts (value_text → normalizer → cents, bbox, confidence).
- **M4.3 Path-2 extraction stage:** Anthropic structured-outputs pass with page images + registry schema; independent of Path 1 (must not see Path-1 values).
- **M4.4 Consensus reconciler (deterministic):** field-level compare → agree ⇒ consensus fact (high confidence); disagree/missing ⇒ review candidate with both values + crops. Registry cross-field relations evaluated as third signal. Property tests + fixture tests.
- **M4.5 Fact writer:** consensus output → `facts` with full lineage; idempotent re-runs supersede prior suggested facts, never touch accepted/overridden ones (test this hard).
- **M4.6 Thin-slice UI:** minimal deal page listing extracted facts per form with confidence chips and page-image crop per fact. Ugly is fine — this is the first end-to-end demo.
- **M4.7 Eval milestone:** run corpus through M4 pipeline; record baseline; target ≥97% field precision on native PDFs, ≥90% scanned, auto-accept coverage reported. Tune prompts/registry (not ground truth!) to improve.
- **M4.8 Registry-only facts (ADR-0002 follow-up):** derived tax lines with no taxonomy placement (AGI, taxable income) must insert as facts keyed by `registry_field_id` alone instead of being silently dropped after extraction. Acceptance: `facts.taxonomy_node_key` nullable with a CHECK that `registry_field_id` is non-null when taxonomy is null; extract stage inserts registry-only facts with full lineage; G1 skips them while G4/G5 key on registry ids (registry relations/flows wired into the deal-wide gate run); workspace Tax Spread tab renders registry-keyed rows from these facts.

**Exit gate M4:** a real 1120-S uploads → splits → dual-extracts → consensus facts with lineage render in thin-slice UI; eval baseline committed. **This is the first investor-demoable moment.**

---

## M5 — Statement extraction (P&L / balance sheet)

- **M5.1 Layout→table stage** via adapter: cells with text+bbox+row/col identity. No hand-rolled geometry (post-mortem traps 1/6/7 test: blank middle cell must NOT shift columns — regression fixture required).
- **M5.2 Row typing (deterministic):** item/subtotal/total/header via indentation, style, and numeric verification (subtotal = Σ block above). Fixtures across QuickBooks/CPA/hand-built styles.
- **M5.3 Period binding (deterministic):** header parsing → canonical periods (FY, interim months/quarters, TTM); "in thousands" detection; geometric column binding.
- **M5.4 Taxonomy mapper:** learned-mappings lookup (tenant → global, exact → fuzzy ≥95) → LLM batch label classification (labels only, no numbers) → unmapped → review. Write-back of confirmed mappings. Cost decay test: second identical doc uses zero LLM calls.
- **M5.5 Structure validation:** re-aggregate mapped tree; parsed vs computed subtotals ±$1; A=L+E on balance sheets ±$2; violations → issues.
- **M5.6 Eval:** statement corpus baseline; per-node mapping accuracy target ≥95%, value binding ≥98% native.

**Exit gate M5:** messy QuickBooks P&L + CPA balance sheet flow to mapped facts with issues raised where structure breaks.

---

## M6 — Validation gates, confidence, review queue

- **M6.1 Gate engine:** G1–G6 per Blueprint §4.5 as pure functions over facts; blocking semantics (implicated fields cannot auto-accept); results → `issues`.
- **M6.2 Confidence scorer:** combine extractor agreement, vendor confidence, gate outcomes → auto-accept / review / reject. Thresholds in config; ROC-style tuning notebook against corpus (auto-accept precision ≥99.5% governs the threshold, coverage is what it is).
- **M6.3 Review queue API:** next-item ordering (severity → doc order), accept/correct/skip mutations (audited), correction → fact supersession + learned-mapping/corpus feedback event.
- **M6.4 Review queue UI:** keyboard-first (a/c/s/↵), source crop with bbox highlight vs candidate values, progress bar, per-field context (form, line, period). Target interaction: <5s median per field.
- **M6.5 Document assignment UI:** confirm/fix split & entity assignment from M3.5.
- **M6.6 E2E test:** seeded deal with planted disagreements → reviewer resolves → facts finalized → gates green.

**Exit gate M6:** zero-wrong-values-past-review demonstrated on corpus run (eval metric = 0); reviewer flow usable end-to-end.

---

## M7 — Calc engine & policy pack

- **M7.1 Engine core** (`packages/engine`): pure function `(facts, addbacks, scenario, policyPack) → metrics`; DAG per Blueprint §7; bigint cents; engine_version constant; zero I/O imports enforced by lint boundary.
- **M7.2 Amortization module:** monthly amortization, Prime+spread with SBA caps, 10y/25y structures, stepped/interim rates; property-based tests + cross-check fixtures generated from a finance library and **[PRATIK]**'s trusted Excel.
- **M7.3 Addback flow:** rule-suggested addbacks from facts (D&A, interest, officer comp, one-time via taxonomy nodes) written as `suggested`; accept/reject API; ONE model (trap 8 test: engine reads accepted only, suggestions visible in UI).
- **M7.4 Global cash flow:** guarantor personal income aggregation (1040/W-2/K-1 facts) − living expense input − personal debt service; combined DSCR.
- **M7.5 Policy evaluation:** pass/fail/margin per policy rule; deal pins its policy_pack_version.
- **M7.6 Golden pro-forma tests** **[PRATIK]**: 3–5 complete real deals with expert-built Excel outcomes → engine must reproduce every metric to the cent (or documented rounding diff). These are the engine's constitution.
- **M7.7 Recompute orchestration:** any fact/addback/scenario mutation → server recompute → computed_metrics upsert → UI invalidation. No client math anywhere (CI grep-check for arithmetic on metric fields in `apps/web`).

**Exit gate M7:** golden deals reproduce expert Excel; override → recompute round-trip < 2s.

---

## M8 — Underwriting workspace (the dashboard restructure)

- **M8.1 Port visual identity:** copy V1 palette/utilities verbatim (Blueprint §8.1) into Tailwind v4 theme; fix scrollbar + focus-ring issues; theme toggle.
- **M8.2 Workspace shell:** three-zone layout (left rail / center spread / right inspector) + persistent metrics strip; responsive collapse rules; panel state in URL.
- **M8.3 Spread grid:** AG Grid; tabs Income Statement · Balance Sheet · Tax Spread · Global Cash Flow · Pro-Forma; period columns (FY/interim/TTM); taxonomy row tree with expand/collapse; computed rows violet + SBA badge; confidence chips; inline label rename (writes learned mapping).
- **M8.4 Source viewer (hero feature):** cell select → right panel renders PDF page with bbox highlight (pdf.js); lineage details (doc, page, method, confidence, history); override + revert; addback action with category picker (no more hardcoded "other").
- **M8.5 Issues panel:** gate violations grouped by severity; click → affected cells highlighted; resolve via override/review.
- **M8.6 Loan scenario inspector:** structured inputs (amount, rate spec, term, use of proceeds, equity injection); multiple scenarios; metrics strip + policy chips update on save.
- **M8.7 Deal dashboard:** pipeline board (Intake → Parsing → Review → Complete), doc-completeness checklist per deal type, DSCR at a glance; new-deal wizard (type, entities, doc checklist).
- **M8.8 Live pipeline progress:** Trigger.dev Realtime stage events → per-document progress UI (replaces V1's opaque spinner).
- **M8.9 Playwright E2E:** upload → review → override → recompute → policy chips update.

**Exit gate M8:** full demo flow on a real deal in <10 minutes of user time; **[PRATIK]** walkthrough sign-off on layout.

---

## M9 — IRS transcripts

- **M9.1 Provider selection** **[PRATIK]**: evaluate TaxStatus vs Halcyon-class providers (pricing, 8821 e-sign UX, business-entity transcript coverage, API SLAs); ADR-0003.
- **M9.2 TranscriptProvider interface + adapter;** consent flow (embedded 8821 e-sign, status tracking per entity).
- **M9.3 Transcript ingest:** structured payload → facts (`method=transcript`, precedence per Blueprint §6) mapped through Form Registry line ids.
- **M9.4 G5 gate + tamper flag:** parsed-vs-transcript diff view in workspace; mismatch issue severity high; "verified by IRS transcript" badge on matching fields.
- **M9.5 Graceful absence:** entire product works with zero consents (feature-flagged per deal).

**Exit gate M9:** demo deal shows transcript-verified badge + one planted mismatch surfaced as tamper flag.

---

## M10 — Export, hardening, launch

- **M10.1 XLSX export (exceljs):** banker workbook — Spread, Addbacks, Global CF, Pro-Forma, Assumptions tabs; formulas live where feasible; branding; snapshot test against golden workbook.
- **M10.2 Observability:** Sentry (web + jobs), structured logs with run ids, cost dashboard from extraction_runs, alerting on failure rates/cost anomalies.
- **M10.3 Security pass:** dependency audit; authz test suite (every route × role matrix); rate limits; signed-URL TTL review; log PII scrub verification; restore-from-backup drill.
- **M10.4 SOC 2 groundwork:** access review doc, vendor register, change-management policy (PR-based), incident runbook in `/docs`.
- **M10.5 Load & cost rehearsal:** 20 concurrent deal uploads; queue behavior, vendor rate limits, per-deal cost within Blueprint §12 envelope.
- **M10.6 Final eval certification:** full corpus run; publish scorecard (auto-accept precision ≥99.5%, silent-wrong-value = 0, coverage number honest); this scorecard is the marketing claim's evidence.
- **M10.7 Pilot onboarding kit** **[PRATIK]**: 2–3 design-partner brokers/banks; feedback loop into corpus.

**Exit gate M10 = MVP launch:** a design partner processes a real deal unassisted; scorecard published internally.

---

## M11 — Platform shell (MVP 2.5: identity, notifications, validation, UI standard)

Design: `docs/design/platform/00-SYNTHESIS.md` (authoritative) + 01–04.
Adversarially reviewed 2026-07-28; blocking fixes B1–B4/A1/X1–X5/C1 are
binding requirements. Standing rules in synthesis §4 apply to every PR.

- **M11.1 UI primitives:** Button v2 (brand geometry: gradient, rounded-lg, Geist semibold) + Skeleton/Tabs/Tooltip/EmptyState/PageHeader/StatTile + reduced-motion; e2e accessible-name invariants (X4) preserved per PR.
- **M11.2 Org bootstrap:** org enums (`org_kind`), `tenants.settings`, `profiles.status`, `org_owner` value, `parent_tenant_id` seam (NULL-only), `create_organization()` definer, `/signup` + `/welcome` flows.
- **M11.3 Members & invites:** append-mostly `invites` (token_hash, expiry, revoke) + `/org/members` + `/org/invites`; role-tier lattice enforced in RLS (A1); audit triggers on profiles/invites/tenants; profile settings + password reset + email change.
- **M11.4 Identity groundwork:** persist split-stage `entity_hint`; deterministic name-matcher in packages/shared (token-set + Jaro-Winkler; fixture table from design 02 §3.7) — pure TDD, no vendor spend.
- **M11.5 Notifications + shell v2:** notifications schema/router (typed events, capability-derived recipients, hardened fan-out — B1/B4/X3) + left-sidebar shell + top bar with bell/panel; workspace cockpit unchanged inside shell.
- **M11.6 Entity↔document validation substage:** registry identity TEXT fields (taxpayer/business name, EIN/SSN-last4 where printed) + pipeline substage writing `document_identities` (auto-confirm band OFF initially) + assignment-screen identity UI + "Name matches NN% — approve?" notifications. Gated on eval/CI green.

**Exit gate M11:** a lender org signs up, invites a member, both see brand-standard UI with a working notification bell; a mismatched-name document raises an approvable identity notification with full lineage.

## M12 — Borrower portal & bank-grade hardening (post-walkthrough feedback)

- **M12.1 Borrower portal:** magic-link invites scoped to (deal, entity); upload-only RLS with full path pinning (B2/B3); curated status tracker; checklist-driven uploads; T+7 reminder; upload quotas + AV-before-extraction.
- **M12.2 Remaining roles:** loan_officer, processor, auditor, it_admin, external per-deal seats; capability layer + team visibility mode.
- **M12.3 Vendor-security GAP list:** session timeouts, rate limits/lockout, auth event logging, PII-at-rest decision, retention/offboarding, audit tamper evidence, email SPF/DKIM/DMARC + DPA, CSP/headers, RLS harness as CI gate.
- **M12.4 Email digests + document-request messaging.**

---

## Dependency map (why this order has no blockers)

```
M0 → M1 → M2 → M3 → M4 → M6 → M7 → M8 → M10
            └──→ M5 ──┘         └→ M9 ─┘
[PRATIK] long-poles started early: corpus labeling (M1.3) during M2–M3;
vendor keys (M0.5) before M3.3; golden Excel deals (M7.6) during M5–M6.
```

M5 (statements) can run in parallel with M4 (tax forms) if capacity allows — they share M3 outputs and don't touch each other. M9 is deliberately late: additive, independent, feature-flagged.
